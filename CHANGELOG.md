# Changelog

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
