# oneOf/anyOf Error Message Improvement

**Date:** 2026-04-06
**Status:** Approved

## Problem

When a `oneOf` or `anyOf` validation fails, the current error message is:

```
response.summary.products[0]: does not match any allowed schema (oneOf)
```

This gives no insight into WHY none of the branches matched. In CI output, the user is left guessing — wrong discriminator? Missing field? Extra property?

## Solution: Discriminator-first + Best-match fallback

Two-step resolution strategy that replaces the generic message with actionable details.

### Step 1 — Discriminator check

If the schema declares a `discriminator` (OpenAPI 3.x standard), read the discriminator field name (e.g., `"type"`), look up its value in the payload, and map it to the correct branch. Return only that branch's sub-errors.

Output format:
```
oneOf matched branch "card" (via discriminator "type"), but: missing required property "cvv"
```

If the discriminator field is missing from the payload or the value doesn't map to any branch, fall through to Step 2.

### Step 2 — Best-match fallback

If no discriminator exists, pick the branch with the fewest validation errors. On ties, pick the first one. Return that branch's sub-errors.

Output format:
```
oneOf best match (branch 1 of 3) failed: missing required property "price", unexpected property "plan"
```

### Same logic applies to `anyOf`

The resolution strategy is identical for `anyOf` failures.

## Implementation

### Data: Preserving Ajv sub-errors

Currently `collapseCompositionErrors` discards all per-branch sub-errors. Instead, group them by branch index before resolution.

Ajv emits sub-errors in order per branch, each with a `schemaPath` like `/oneOf/0/...`, `/oneOf/1/...`. The branch index is extracted from this path.

### Code changes (all in `src/validator.ts`)

1. **Replace `collapseCompositionErrors`** with `resolveCompositionErrors(rawErrors, schema, payload)`:
   - Groups sub-errors by branch index from Ajv's `schemaPath`
   - Checks schema for `discriminator` property
   - Reads discriminator field value from payload
   - Runs two-step resolution (discriminator-first, best-match fallback)
   - Rewrites the oneOf/anyOf error message with branch details and sub-error summary
   - Returns the resolved errors

2. **Update `validate()` method** — pass `schemaToValidate` and `payload` into the new function.

3. **No changes to `ValidationError` interface** — the `message` field gets a richer string. No new fields, no breaking changes.

4. **No changes to `normalize.ts`** — nullable-to-oneOf rewrite produces standard oneOf schemas; resolution logic works the same way.

## Output format

Flat string, CI-friendly. Same `path: message` structure as today:

```
-> response.summary.products[0]: oneOf matched branch "physical" (via discriminator "type"), but: missing required property "weight"
-> response.summary.products[0]: oneOf best match (branch 1 of 3) failed: missing required property "price", unexpected property "plan"
```

Sub-errors are joined with `, ` into the message string.

## Testing

New and updated tests in `tests/composition.test.ts`.

### Discriminator path

- Schema with `discriminator: { propertyName: "type" }` — payload has `type: "card"` but fails on another field — error message references branch "card" and shows the specific failure
- Discriminator field present but value doesn't map to any branch — falls back to best-match

### Best-match fallback

- Schema without discriminator — payload nearly matches one branch (1 error) but is far from the other (3 errors) — error picks the closest branch and shows its errors
- Tie scenario (equal error counts) — picks first branch, no crash

### Edge cases

- Nested oneOf (existing `allOf containing oneOf` tests) — verify sub-errors resolve correctly
- `anyOf` gets the same treatment — same resolution logic applies
- Single-branch oneOf — shows that branch's errors directly

### Fixture changes

Extend `tests/fixtures/composition.json` with a discriminator-based oneOf schema to test the discriminator path, since the current fixture doesn't use `discriminator`.
