# Fix allOf Strict Mode False Positives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `addAdditionalPropertiesFalse` so that `allOf` branches share sibling properties, eliminating false positives when strict mode encounters `oneOf > allOf` patterns.

**Architecture:** When processing `allOf`, collect the union of all property keys across branches, then inject empty `{}` stubs for missing sibling properties into each branch before applying `additionalProperties: false`. This ensures each branch accepts properties defined by its siblings. No changes to types, normalize, or the validation pipeline — only the strict-mode schema transformation.

**Tech Stack:** TypeScript, Ajv 2020, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `tests/fixtures/composition.json` | Modify | Add `/v1/cart-items` endpoint with `oneOf > allOf` pattern |
| `tests/composition.test.ts` | Modify | Add failing tests, then regression tests |
| `src/validator.ts:181-212` | Modify | Fix `addAdditionalPropertiesFalse` to merge allOf sibling properties |

---

### Task 1: Add fixture with oneOf > allOf pattern

**Files:**
- Modify: `tests/fixtures/composition.json`

- [ ] **Step 1: Add `/v1/cart-items` endpoint to the fixture**

Add a new path entry after `/v1/nested-composition` (before the final closing `}}`). This endpoint mirrors the real-world Holafly pattern: a `oneOf` where each branch uses `allOf` to merge a base schema (shared type enum) with a specific schema (narrow type enum + variant properties).

In `tests/fixtures/composition.json`, insert before the final closing `}}` (after line 204):

```json
,
"/v1/cart-items": {
  "post": {
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "allOf": [
                    {
                      "type": "object",
                      "required": ["type", "value"],
                      "properties": {
                        "type": { "type": "string", "enum": ["plan", "trip", "credit-recharge"] }
                      }
                    },
                    {
                      "type": "object",
                      "properties": {
                        "type": { "type": "string", "enum": ["plan"] },
                        "value": {
                          "type": "object",
                          "required": ["name", "sku"],
                          "properties": {
                            "name": { "type": "string" },
                            "sku": { "type": "string" },
                            "periodicity": { "type": "string", "enum": ["monthly", "yearly"] },
                            "metadata": {
                              "type": "object",
                              "required": ["recurrence"],
                              "properties": {
                                "recurrence": { "type": "string", "enum": ["monthly", "yearly"] }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                },
                {
                  "allOf": [
                    {
                      "type": "object",
                      "required": ["type", "value"],
                      "properties": {
                        "type": { "type": "string", "enum": ["plan", "trip", "credit-recharge"] }
                      }
                    },
                    {
                      "type": "object",
                      "properties": {
                        "type": { "type": "string", "enum": ["trip"] },
                        "value": {
                          "type": "object",
                          "required": ["name", "sku", "days"],
                          "properties": {
                            "name": { "type": "string" },
                            "sku": { "type": "string" },
                            "days": { "type": "integer" },
                            "metadata": {
                              "type": "object",
                              "required": ["days"],
                              "properties": {
                                "days": { "type": "integer" }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                },
                {
                  "allOf": [
                    {
                      "type": "object",
                      "required": ["type", "value"],
                      "properties": {
                        "type": { "type": "string", "enum": ["plan", "trip", "credit-recharge"] }
                      }
                    },
                    {
                      "type": "object",
                      "properties": {
                        "type": { "type": "string", "enum": ["credit-recharge"] },
                        "value": {
                          "type": "object",
                          "required": ["name", "sku"],
                          "properties": {
                            "name": { "type": "string" },
                            "sku": { "type": "string" }
                          }
                        }
                      }
                    }
                  ]
                }
              ],
              "discriminator": {
                "propertyName": "type"
              }
            }
          }
        }
      }
    },
    "responses": {
      "200": {
        "description": "Cart items validated",
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["ok"],
              "properties": {
                "ok": { "type": "boolean" }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate JSON is well-formed**

Run: `node -e "require('./tests/fixtures/composition.json'); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Run existing tests to confirm no breakage**

Run: `npx vitest run tests/composition.test.ts`
Expected: All existing tests PASS (new endpoint has no tests yet).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/composition.json
git commit -m "test: add oneOf-allOf fixture for strict mode false positive reproduction"
```

---

### Task 2: Write failing test for the false positive

**Files:**
- Modify: `tests/composition.test.ts`

- [ ] **Step 1: Add a describe block with the failing test**

Add at the end of the file, inside the top-level `describe('composition validation', ...)` block, before its closing `});`:

```typescript
describe('oneOf with allOf branches (strict mode)', () => {
  it('validates plan item without false positive', () => {
    const result = validator.validateRequest('/v1/cart-items', 'post', [
      {
        type: 'plan',
        value: {
          name: 'Unlimited Plan',
          sku: 'plan-unlimited',
          periodicity: 'monthly',
          metadata: { recurrence: 'monthly' },
        },
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates trip item without false positive', () => {
    const result = validator.validateRequest('/v1/cart-items', 'post', [
      {
        type: 'trip',
        value: {
          name: 'Spain',
          sku: 'trip-spain',
          days: 7,
          metadata: { days: 7 },
        },
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates credit-recharge item without false positive', () => {
    const result = validator.validateRequest('/v1/cart-items', 'post', [
      {
        type: 'credit-recharge',
        value: {
          name: 'Credit Recharge 500',
          sku: 'credit-recharge-500',
        },
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates mixed cart items without false positive', () => {
    const result = validator.validateRequest('/v1/cart-items', 'post', [
      {
        type: 'plan',
        value: {
          name: 'Unlimited Plan',
          sku: 'plan-unlimited',
          periodicity: 'monthly',
          metadata: { recurrence: 'monthly' },
        },
      },
      {
        type: 'trip',
        value: {
          name: 'Spain',
          sku: 'trip-spain',
          days: 7,
          metadata: { days: 7 },
        },
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/composition.test.ts -t "oneOf with allOf branches"`
Expected: FAIL — all 4 tests fail with false positive errors like `"must NOT have additional properties"`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/composition.test.ts
git commit -m "test: add failing tests for oneOf-allOf strict mode false positive"
```

---

### Task 3: Fix `addAdditionalPropertiesFalse` to merge allOf sibling properties

**Files:**
- Modify: `src/validator.ts:181-212`

- [ ] **Step 1: Replace the `allOf` handling in `addAdditionalPropertiesFalse`**

In `src/validator.ts`, replace the composition keywords loop (lines 202-209):

```typescript
    // Recurse into composition keywords
    for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(schema[keyword])) {
        for (const branch of schema[keyword] as Record<string, unknown>[]) {
          this.addAdditionalPropertiesFalse(branch);
        }
      }
    }
```

with:

```typescript
    // Recurse into oneOf/anyOf branches
    for (const keyword of ['oneOf', 'anyOf']) {
      if (Array.isArray(schema[keyword])) {
        for (const branch of schema[keyword] as Record<string, unknown>[]) {
          this.addAdditionalPropertiesFalse(branch);
        }
      }
    }

    // For allOf: merge sibling properties before recursing so each branch
    // knows about properties defined in other branches. Without this,
    // additionalProperties:false on branch A rejects properties from branch B.
    if (Array.isArray(schema.allOf)) {
      const branches = schema.allOf as Record<string, unknown>[];

      // Collect the union of all property keys across all allOf branches
      const allPropertyKeys = new Set<string>();
      for (const branch of branches) {
        if (branch.properties && typeof branch.properties === 'object') {
          for (const key of Object.keys(branch.properties as Record<string, unknown>)) {
            allPropertyKeys.add(key);
          }
        }
      }

      // Inject empty stubs for missing sibling properties into each branch
      if (allPropertyKeys.size > 0) {
        for (const branch of branches) {
          if (branch.properties && typeof branch.properties === 'object') {
            const props = branch.properties as Record<string, unknown>;
            for (const key of allPropertyKeys) {
              if (!(key in props)) {
                props[key] = {};
              }
            }
          }
        }
      }

      // Now recurse into each branch
      for (const branch of branches) {
        this.addAdditionalPropertiesFalse(branch);
      }
    }
```

- [ ] **Step 2: Run the failing tests from Task 2**

Run: `npx vitest run tests/composition.test.ts -t "oneOf with allOf branches"`
Expected: PASS — all 4 tests now pass.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All 97 existing tests + 4 new tests PASS (101 total).

- [ ] **Step 4: Commit**

```bash
git add src/validator.ts
git commit -m "fix: merge allOf sibling properties before applying additionalProperties:false"
```

---

### Task 4: Add regression tests

Verify existing patterns still work correctly with the fix in place.

**Files:**
- Modify: `tests/composition.test.ts`

- [ ] **Step 1: Add strict-mode allOf test (previously only tested with lenient)**

The existing `allOf (merged user properties)` tests use `lenientValidator`. Add a strict-mode test that confirms the fix also works for plain allOf (not inside oneOf). Add inside the existing `allOf (merged user properties)` describe block:

```typescript
it('validates merged properties in strict mode', () => {
  const result = validator.validateResponse('/v1/users/{userId}', 'get', 200, {
    id: 1,
    email: 'test@example.com',
    name: 'John',
    avatar: null,
  });
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/composition.test.ts -t "validates merged properties in strict mode"`
Expected: PASS — the fix also handles plain allOf correctly.

- [ ] **Step 3: Add test that strict mode still rejects truly invalid payloads for oneOf-allOf**

Add inside the `oneOf with allOf branches (strict mode)` describe block:

```typescript
it('still rejects invalid type value in strict mode', () => {
  const result = validator.validateRequest('/v1/cart-items', 'post', [
    {
      type: 'unknown',
      value: { name: 'Test', sku: 'test' },
    },
  ]);
  expect(result.valid).toBe(false);
});

it('still rejects extra properties on the item in strict mode', () => {
  const result = validator.validateRequest('/v1/cart-items', 'post', [
    {
      type: 'plan',
      value: { name: 'Plan', sku: 'plan-1', periodicity: 'monthly', metadata: { recurrence: 'monthly' } },
      extraField: 'should not be here',
    },
  ]);
  expect(result.valid).toBe(false);
});

it('still rejects missing required fields in strict mode', () => {
  const result = validator.validateRequest('/v1/cart-items', 'post', [
    {
      type: 'trip',
      value: { name: 'Spain' },
    },
  ]);
  expect(result.valid).toBe(false);
});
```

- [ ] **Step 4: Run all new regression tests**

Run: `npx vitest run tests/composition.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite one final time**

Run: `npx vitest run`
Expected: All tests PASS (should be 105 total: 97 original + 4 from Task 2 + 4 from Task 4).

- [ ] **Step 6: Commit**

```bash
git add tests/composition.test.ts
git commit -m "test: add regression tests for strict-mode allOf property merging"
```
