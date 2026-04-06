# Fix: allOf inside oneOf produces false positives in strict mode

**Date:** 2026-04-06
**Status:** Approved

## Problem

When strict mode is enabled (`strict: true`), `addAdditionalPropertiesFalse` adds `additionalProperties: false` to each `allOf` branch independently. This causes false positives because each branch only knows its own properties and rejects sibling properties as "additional."

Real-world pattern that triggers it (from Holafly checkout API):

```
oneOf:
  - allOf:
      - base: { type: enum["plan","trip","credit-recharge"], required: [type, value] }
      - specific: { type: enum["plan"], value: { ...plan fields } }
  - allOf:
      - base: { type: enum["plan","trip","credit-recharge"], required: [type, value] }
      - specific: { type: enum["trip"], value: { ...trip fields } }
```

With strict mode, the base branch gets `additionalProperties: false` and only knows about `type` — so it rejects `value` as unexpected. The payload is valid but the validator reports a false positive.

## Solution: Merge allOf sibling properties before applying strict

When `addAdditionalPropertiesFalse` encounters an `allOf` array:

1. Collect all `properties` keys from every allOf branch into a union set
2. For each branch that is an object schema with properties, add empty `{}` stubs for any sibling properties it doesn't have
3. Then apply `additionalProperties: false` as normal per branch

This way each branch knows about all properties across all sibling branches and won't reject them as additional. The actual shape validation of each property is still handled by the branch that defines it.

### Example

Before (broken):
```
allOf:
  - { properties: { type: {...} }, additionalProperties: false }       <- rejects "value"
  - { properties: { type: {...}, value: {...} }, additionalProperties: false }
```

After (fixed):
```
allOf:
  - { properties: { type: {...}, value: {} }, additionalProperties: false }  <- allows "value"
  - { properties: { type: {...}, value: {...} }, additionalProperties: false }
```

## Implementation

### Code changes (all in `src/validator.ts`)

Modify `addAdditionalPropertiesFalse` (lines 181-212). Before the existing `allOf` recursion loop, add the property-merging step. No other files change.

### What does NOT change

- `ValidationError` interface — no changes
- `normalize.ts` — no changes
- `collapseCompositionErrors` — no changes
- Lenient mode behavior — completely unaffected (strict logic only runs when `strict: true`)
- oneOf/anyOf without allOf — unaffected (no allOf branches to merge)

## Testing

### New tests

1. **allOf inside oneOf with strict mode** — the core fix. Add a fixture endpoint that mirrors the real Holafly pattern (oneOf with allOf branches using base+specific schemas). Validate with strict validator — must pass for valid payloads.

2. **Strict mode allOf without oneOf** — verify that plain allOf with merged properties also works in strict mode (the existing test only uses lenient mode).

### Regression tests

3. **All existing lenient-mode allOf tests still pass** — the `allOf (merged user properties)` block must remain green.

4. **All existing strict-mode oneOf tests still pass** — the `/v1/payments` tests (simple oneOf without allOf) must remain green.

5. **All existing tests pass** — full test suite run.

### Fixture changes

Add a new endpoint to `tests/fixtures/composition.json` that uses `oneOf > allOf` with a discriminator, matching the real-world pattern.
