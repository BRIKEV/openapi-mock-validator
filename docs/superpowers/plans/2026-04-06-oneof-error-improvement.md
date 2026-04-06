# oneOf/anyOf Error Message Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic "does not match any allowed schema (oneOf)" message with actionable per-branch error details, using discriminator-aware resolution when available and a best-match heuristic as fallback.

**Architecture:** Replace `collapseCompositionErrors()` with `resolveCompositionErrors()` that groups Ajv sub-errors by branch index (parsed from `schemaPath`), checks for OpenAPI `discriminator`, and either targets the intended branch or picks the branch with fewest errors. The raw Ajv errors are preserved through the map step and only resolved at the end. No changes to `ValidationError` interface — only the `message` string gets richer.

**Tech Stack:** TypeScript, Ajv 2020, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/validator.ts` | Modify (lines 110-178, 274-289) | Replace `collapseCompositionErrors` with `resolveCompositionErrors`; thread schema+payload through; preserve raw Ajv `schemaPath` on errors |
| `src/types.ts` | No change | `ValidationError` interface stays the same |
| `tests/composition.test.ts` | Modify | Add tests for discriminator resolution, best-match fallback, edge cases |
| `tests/fixtures/composition.json` | Modify | Already has discriminator on `/v1/payments`; add a no-discriminator oneOf endpoint for best-match testing |

---

### Task 1: Add fixture endpoint for no-discriminator oneOf

**Files:**
- Modify: `tests/fixtures/composition.json`

- [ ] **Step 1: Add `/v1/notifications` endpoint to the fixture**

Add a new path at the end of the `paths` object in `tests/fixtures/composition.json`, before the closing `}}`. This endpoint has a `oneOf` with no discriminator — two notification shapes with different required fields:

```json
"/v1/notifications": {
  "post": {
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "oneOf": [
              {
                "type": "object",
                "required": ["channel", "recipient", "body"],
                "properties": {
                  "channel": { "type": "string", "enum": ["email"] },
                  "recipient": { "type": "string", "format": "email" },
                  "body": { "type": "string" },
                  "subject": { "type": "string" }
                }
              },
              {
                "type": "object",
                "required": ["channel", "recipient", "body"],
                "properties": {
                  "channel": { "type": "string", "enum": ["sms"] },
                  "recipient": { "type": "string" },
                  "body": { "type": "string" }
                }
              },
              {
                "type": "object",
                "required": ["channel", "webhookUrl", "payload"],
                "properties": {
                  "channel": { "type": "string", "enum": ["webhook"] },
                  "webhookUrl": { "type": "string", "format": "uri" },
                  "payload": { "type": "object" }
                }
              }
            ]
          }
        }
      }
    },
    "responses": {
      "202": {
        "description": "Notification accepted",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["id"],
              "properties": {
                "id": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run tests/composition.test.ts`
Expected: All existing tests PASS (the new endpoint doesn't affect them).

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/composition.json
git commit -m "test: add no-discriminator oneOf fixture for notifications endpoint"
```

---

### Task 2: Preserve raw Ajv `schemaPath` on mapped errors

The `resolveCompositionErrors` function needs access to Ajv's `schemaPath` to group errors by branch. Currently the `.map()` at line 126 discards it. We need to carry it through.

**Files:**
- Modify: `src/validator.ts:126-172`

- [ ] **Step 1: Write a failing test that expects branch-aware error messages**

Add to `tests/composition.test.ts` inside the `oneOf (payment methods)` describe block:

```typescript
it('shows discriminator-targeted error for wrong branch field', () => {
  const result = validator.validateRequest('/v1/payments', 'post', {
    type: 'card',
    wrong: 'field',
  });
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toContain('branch "card"');
  expect(result.errors[0].message).toContain('cardNumber');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/composition.test.ts -t "shows discriminator-targeted error"`
Expected: FAIL — current message is `"does not match any allowed schema (oneOf)"`, does not contain `"branch"`.

- [ ] **Step 3: Add `_schemaPath` to the error mapping in `validate()`**

In `src/validator.ts`, modify the `.map()` callback (line 126-172). Add `_schemaPath` to the constructed error object so the resolution function can read it later. The underscore prefix signals it's internal and gets stripped before returning.

Replace the current error construction block (lines 131-135):

```typescript
      const error: ValidationError & { _schemaPath?: string } = {
        path: dotPath,
        message: (err.message as string) || 'validation failed',
        keyword: err.keyword as string,
        _schemaPath: err.schemaPath as string,
      };
```

- [ ] **Step 4: Run all tests to confirm nothing breaks**

Run: `npx vitest run tests/composition.test.ts`
Expected: The new test still FAILS (we haven't changed the resolution logic yet), but all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validator.ts tests/composition.test.ts
git commit -m "refactor: preserve Ajv schemaPath on mapped errors for branch grouping"
```

---

### Task 3: Implement `resolveCompositionErrors`

Replace `collapseCompositionErrors` with the new two-step resolution function.

**Files:**
- Modify: `src/validator.ts:274-289` (replace function), `src/validator.ts:174-176` (call site)

- [ ] **Step 1: Write the `resolveCompositionErrors` function**

Replace the `collapseCompositionErrors` function (lines 274-289) with:

```typescript
function resolveCompositionErrors(
  errors: (ValidationError & { _schemaPath?: string })[],
  schema: Record<string, unknown>,
  payload: unknown,
): ValidationError[] {
  if (errors.length <= 1) return errors;

  const last = errors[errors.length - 1];
  if (last.keyword !== 'oneOf' && last.keyword !== 'anyOf') {
    return errors;
  }

  const compositionPath = last.path;
  const keyword = last.keyword; // 'oneOf' or 'anyOf'

  // Separate: sub-errors under this composition vs unrelated errors
  const subErrors: (ValidationError & { _schemaPath?: string })[] = [];
  const otherErrors: ValidationError[] = [];
  for (const e of errors) {
    if (e === last) continue;
    if (e.path.startsWith(compositionPath) && e._schemaPath?.includes(`/${keyword}/`)) {
      subErrors.push(e);
    } else {
      otherErrors.push(e);
    }
  }

  // Group sub-errors by branch index (parsed from schemaPath like "#/oneOf/0/required")
  const branches = new Map<number, ValidationError[]>();
  for (const e of subErrors) {
    const match = e._schemaPath?.match(new RegExp(`/${keyword}/(\\d+)`));
    if (match) {
      const idx = parseInt(match[1], 10);
      if (!branches.has(idx)) branches.set(idx, []);
      branches.get(idx)!.push(e);
    }
  }

  if (branches.size === 0) {
    // No parseable branch info — return the generic composition error
    return [...otherErrors, stripInternal(last)];
  }

  // Step 1: Try discriminator
  const schemaAtPath = findSchemaAtCompositionPath(schema, last._schemaPath || '');
  const discriminator = schemaAtPath?.discriminator as { propertyName?: string } | undefined;

  if (discriminator?.propertyName && typeof payload === 'object' && payload !== null) {
    const discValue = (payload as Record<string, unknown>)[discriminator.propertyName];
    if (typeof discValue === 'string') {
      // Find the branch that matches this discriminator value
      const branchSchemas = (schemaAtPath?.[keyword] as Record<string, unknown>[]) || [];
      for (let i = 0; i < branchSchemas.length; i++) {
        const branchProps = (branchSchemas[i].properties as Record<string, Record<string, unknown>>) || {};
        const discProp = branchProps[discriminator.propertyName];
        const enumValues = discProp?.enum as unknown[] | undefined;
        if (enumValues?.includes(discValue) || discProp?.const === discValue) {
          const branchErrors = branches.get(i);
          if (branchErrors && branchErrors.length > 0) {
            const details = branchErrors.map(e => e.message).join(', ');
            const resolved: ValidationError = {
              path: compositionPath,
              message: `${keyword} matched branch "${discValue}" (via discriminator "${discriminator.propertyName}"), but: ${details}`,
              keyword,
            };
            return [...otherErrors, resolved];
          }
          // Branch matched with no sub-errors — shouldn't normally happen, but fall through
          break;
        }
      }
      // Discriminator value didn't map to any branch — fall through to best-match
    }
  }

  // Step 2: Best-match fallback — pick the branch with fewest errors
  const totalBranches = branches.size;
  let bestIdx = 0;
  let bestCount = Infinity;
  for (const [idx, errs] of branches) {
    if (errs.length < bestCount) {
      bestCount = errs.length;
      bestIdx = idx;
    }
  }

  const bestErrors = branches.get(bestIdx)!;
  const details = bestErrors.map(e => e.message).join(', ');
  const resolved: ValidationError = {
    path: compositionPath,
    message: `${keyword} best match (branch ${bestIdx + 1} of ${totalBranches}) failed: ${details}`,
    keyword,
  };
  return [...otherErrors, resolved];
}

function findSchemaAtCompositionPath(
  schema: Record<string, unknown>,
  schemaPath: string,
): Record<string, unknown> | undefined {
  // schemaPath is like "#/oneOf" or "#/items/anyOf" or "#/properties/foo/oneOf"
  // We need to walk the schema to the parent that contains the oneOf/anyOf
  const cleaned = schemaPath.replace(/^#\//, '');
  const parts = cleaned.split('/');

  // Remove the keyword itself (oneOf/anyOf) — we want the parent
  // Find the last occurrence of oneOf or anyOf
  let keywordIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'oneOf' || parts[i] === 'anyOf') {
      keywordIdx = i;
      break;
    }
  }
  if (keywordIdx < 0) return undefined;

  const pathToParent = parts.slice(0, keywordIdx);

  let current: unknown = schema;
  for (const part of pathToParent) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'object' && current !== null
    ? current as Record<string, unknown>
    : undefined;
}

function stripInternal(error: ValidationError & { _schemaPath?: string }): ValidationError {
  const { _schemaPath, ...clean } = error;
  return clean;
}
```

- [ ] **Step 2: Update the call site in `validate()`**

Replace lines 174-176 in `src/validator.ts`:

```typescript
    // Resolve oneOf/anyOf: use discriminator or best-match to provide actionable errors
    const errors = resolveCompositionErrors(rawErrors, schemaToValidate, payload);
```

- [ ] **Step 3: Strip `_schemaPath` from all returned errors**

After the `resolveCompositionErrors` call, strip the internal property before returning. Replace the return statement (line 178):

```typescript
    return { valid: false, errors: errors.map(stripInternal), warnings: existingWarnings };
```

- [ ] **Step 4: Remove the old `collapseCompositionErrors` function**

Delete lines 274-289 (the old `collapseCompositionErrors` function).

- [ ] **Step 5: Run the discriminator test from Task 2**

Run: `npx vitest run tests/composition.test.ts -t "shows discriminator-targeted error"`
Expected: PASS — the error message now contains `branch "card"` and `cardNumber`.

- [ ] **Step 6: Run all existing tests**

Run: `npx vitest run`
Expected: All tests PASS. The existing `rejects payload matching no branch` and `rejects payload matching both branches` tests should still pass — they only assert `valid: false`, not the message content.

- [ ] **Step 7: Commit**

```bash
git add src/validator.ts
git commit -m "feat: replace collapseCompositionErrors with discriminator-aware resolution"
```

---

### Task 4: Add discriminator-path tests

**Files:**
- Modify: `tests/composition.test.ts`

- [ ] **Step 1: Add test for discriminator value not mapping to any branch**

Add inside the `oneOf (payment methods)` describe block:

```typescript
it('falls back to best-match when discriminator value is unknown', () => {
  const result = validator.validateRequest('/v1/payments', 'post', {
    type: 'crypto',
    walletAddress: '0x123',
  });
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toContain('best match');
  expect(result.errors[0].message).toContain('branch');
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/composition.test.ts -t "falls back to best-match when discriminator value is unknown"`
Expected: PASS — the discriminator value `"crypto"` doesn't match any branch enum, so it falls through to best-match.

- [ ] **Step 3: Add test for missing discriminator field in payload**

```typescript
it('falls back to best-match when discriminator field is missing', () => {
  const result = validator.validateRequest('/v1/payments', 'post', {
    cardNumber: '4111111111111111',
  });
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toContain('best match');
});
```

- [ ] **Step 4: Run and verify**

Run: `npx vitest run tests/composition.test.ts -t "falls back to best-match when discriminator field is missing"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/composition.test.ts
git commit -m "test: add discriminator fallback scenarios for oneOf resolution"
```

---

### Task 5: Add best-match fallback tests

**Files:**
- Modify: `tests/composition.test.ts`

- [ ] **Step 1: Add test for best-match picking the closest branch**

Add a new describe block after the existing `oneOf (payment methods)` block:

```typescript
describe('oneOf best-match (no discriminator)', () => {
  it('picks the branch with fewest errors', () => {
    // notifications endpoint has no discriminator
    // email branch needs: channel="email", recipient (email format), body
    // sending channel="email" + recipient + wrong field should match email branch closest
    const result = validator.validateRequest('/v1/notifications', 'post', {
      channel: 'email',
      recipient: 'test@example.com',
      wrong: 'field',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('best match');
    expect(result.errors[0].message).toContain('body');
  });

  it('picks first branch on tie', () => {
    // payload matches no branch well — empty object
    const result = validator.validateRequest('/v1/notifications', 'post', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('best match');
    expect(result.errors[0].message).toContain('branch 1');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/composition.test.ts -t "oneOf best-match"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/composition.test.ts
git commit -m "test: add best-match fallback tests for no-discriminator oneOf"
```

---

### Task 6: Add anyOf and edge case tests

**Files:**
- Modify: `tests/composition.test.ts`

- [ ] **Step 1: Add anyOf resolution test**

Add inside the existing `anyOf (product types)` describe block:

```typescript
it('shows best-match details when item matches no branch', () => {
  const result = validator.validateResponse('/v1/products', 'get', 200, [
    { id: 1, name: 'Widget' },
  ]);
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toContain('anyOf best match');
});
```

- [ ] **Step 2: Run and verify**

Run: `npx vitest run tests/composition.test.ts -t "shows best-match details when item matches no branch"`
Expected: PASS

- [ ] **Step 3: Add nested oneOf test (allOf containing oneOf)**

Add inside the existing `nested composition` describe block:

```typescript
it('shows resolution details for nested oneOf failure', () => {
  const result = lenientValidator.validateResponse('/v1/nested-composition', 'get', 200, {
    id: 1,
    kind: 'typeC',
    valueA: 'hello',
  });
  expect(result.valid).toBe(false);
  // Should have a resolved oneOf error with branch details
  const oneOfError = result.errors.find(e => e.keyword === 'oneOf');
  expect(oneOfError).toBeDefined();
  expect(oneOfError!.message).not.toBe('does not match any allowed schema (oneOf)');
});
```

- [ ] **Step 4: Run and verify**

Run: `npx vitest run tests/composition.test.ts -t "shows resolution details for nested oneOf"`
Expected: PASS

- [ ] **Step 5: Add single-branch oneOf test**

Add inside the `nullable + oneOf` describe block (this schema has a oneOf with only 2 branches after nullable normalization, but we can test the resolution still works with a payload that matches neither):

```typescript
it('shows resolution details for nullable oneOf failure', () => {
  const result = lenientValidator.validateResponse('/v1/nullable-response', 'get', 200, {
    unrelated: 'field',
  });
  expect(result.valid).toBe(false);
  const oneOfError = result.errors.find(e => e.keyword === 'oneOf');
  expect(oneOfError).toBeDefined();
  expect(oneOfError!.message).toContain('best match');
});
```

- [ ] **Step 6: Run and verify**

Run: `npx vitest run tests/composition.test.ts -t "shows resolution details for nullable oneOf"`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/composition.test.ts
git commit -m "test: add anyOf resolution and nested oneOf edge case tests"
```
