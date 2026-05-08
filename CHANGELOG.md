# Changelog

## 0.3.0 (2026-05-08)

### Internal

- **deps:** Bump runtime and dev dependencies. Notably crosses `ajv-formats` v2 → v3. The only behavioral change in v3 is that the `date-time` and `time` formats now require a timezone per RFC3339 — strings like `"2024-04-15T00:00:00"` (no `Z` / offset) will now fail validation. Use the new `iso-time` / `iso-date-time` formats to opt back into the v2 behavior.
- **security:** Bumping `ajv` to ^8.20.0 closes the high-severity `fast-uri` advisories ([GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc)) pulled in transitively.

| package | from | to |
|---|---|---|
| ajv | ^8.18.0 | ^8.20.0 |
| ajv-formats | ^2.1.1 | ^3.0.1 |
| @apidevtools/json-schema-ref-parser | ^15.3.4 | ^15.3.5 |
| path-to-regexp | ^8.4.0 | ^8.4.2 |
| vitest | ^4.1.2 | ^4.1.5 |
| @vitest/coverage-v8 | ^4.1.2 | ^4.1.5 |

## 0.2.0 (2026-04-20)

### Features

- **content-type:** Add optional `contentType` to `ValidatorOptions` for `validateResponse` and `validateRequest`. Defaults to `application/json` (backwards compatible). Media-type resolution order is exact match → family wildcard (`image/*`) → `*/*`. Unmatched binary content types (`image/*`, `video/*`, `audio/*`, `application/octet-stream`, `application/pdf`, `application/zip`) are silently bypassed — no more false-positive `MISSING_SCHEMA` warnings when a mock returns binary data like a QR code.

### Internal

- **normalize:** `normalizeAllSchemas` now rewrites OpenAPI 3.0 → 3.1 schemas under every media-type entry in `content`, not only `application/json`. Previously, schemas declared under e.g. `multipart/form-data` or `image/jpeg` missed the rewrite and could throw at validation time.

## 0.1.4 (2026-04-08)

### Bug Fixes

- **error messages:** Include property names in `required` and `additionalProperties` error messages (e.g., `missing required property "cardNumber"`, `unexpected property "extraField"`). Makes composition error summaries actionable.

## 0.1.3 (2026-04-07)

### Features

- **error messages:** Descriptive oneOf/anyOf error messages. Instead of the generic "does not match any allowed schema", errors now identify the best-matching branch and its specific sub-errors. Supports discriminator-based resolution (e.g., `oneOf matched branch "card" (via discriminator "type"), but: unexpected property "extraField"`) and best-match fallback (e.g., `anyOf best match (branch 1 of 2) failed: expected number, got string`).

## 0.1.2 (2026-04-06)

### Bug Fixes

- **strict mode:** Fix false positives when validating `oneOf` schemas with `allOf` composition. Strict mode was applying `additionalProperties: false` to each `allOf` branch independently, causing sibling properties to be rejected as unexpected. Now merges property keys across `allOf` branches before applying strict constraints.

## 0.1.1 (2026-04-06)

### Bug Fixes

- **normalize:** Handle `nullable: true` without `type` in OpenAPI 3.0 schemas. Schemas using `nullable` on `allOf` compositions or bare description objects were not being normalized, causing Ajv to throw `"nullable" cannot be used without "type"`.

## 0.1.0 (2026-04-06)

### Features

- Initial release
- Validate JSON payloads against OpenAPI 3.0/3.1 specs
- Full `$ref` resolution with nested component references
- OpenAPI 3.0 to 3.1 schema normalization (`nullable`, `exclusiveMinimum`, `exclusiveMaximum`)
- Human-friendly validation error messages
- Reusable Ajv instance for performance
- CI/publish workflows
