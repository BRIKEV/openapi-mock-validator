# openapi-mock-validator

Validate JSON payloads against OpenAPI 3.0/3.1 specs. Catch mock drift before it hits production.

## Why

Frontend teams write mock responses in tests that drift from reality over time. Fields get renamed, removed, or added in the API but mocks stay frozen. Tests pass, code ships, and the app breaks in production.

This package validates mock payloads against the OpenAPI spec — the source of truth. No YAML parsing, no URL fetching — consumers handle I/O, this package handles validation.

## Install

```bash
npm install openapi-mock-validator
```

## Quick Start

```typescript
import { OpenAPIMockValidator } from 'openapi-mock-validator';
import fs from 'node:fs';

// Load the spec yourself (fetch, readFile, etc.)
const spec = JSON.parse(fs.readFileSync('./openapi.json', 'utf-8'));

const validator = new OpenAPIMockValidator(spec);
await validator.init();

// Match a mock URL to a spec path
const match = validator.matchPath('/v1/orders/abc-123/status', 'GET');
// → { path: '/v1/orders/{id}/status', params: { id: 'abc-123' } }

if (match) {
  // Validate the mock response against the spec
  const result = validator.validateResponse(match.path, 'GET', 200, mockPayload);
  // → { valid: false, errors: [...], warnings: [...] }
}
```

## API

### `new OpenAPIMockValidator(spec, options?)`

Creates a validator instance. The spec must be a parsed OpenAPI 3.x JSON object.

```typescript
const validator = new OpenAPIMockValidator(spec, {
  strict: true, // default: true — reject additional properties not in spec
});
```

### `validator.init()`

Dereferences all `$ref`s, normalizes OpenAPI 3.0 schemas to 3.1 format, and compiles path matchers. Must be called before any validation.

```typescript
await validator.init();
```

### `validator.matchPath(url, method)`

Matches a URL against the spec's paths. Returns the matched spec path and extracted parameters, or `null`.

```typescript
const match = validator.matchPath('/v1/pets/abc-123', 'GET');
// → { path: '/v1/pets/{petId}', params: { petId: 'abc-123' } }
// → null if no match
```

- Strips trailing slashes and query strings automatically
- Prefers literal path segments over parameterized ones (`/orders/pending` beats `/orders/{id}`)

### `validator.validateResponse(path, method, status, payload, options?)`

Validates a response payload against the schema defined in the spec.

```typescript
const result = validator.validateResponse('/v1/pets/{petId}', 'GET', 200, {
  id: 1,
  name: 'Fido',
});
```

Returns:

```typescript
{
  valid: boolean;
  errors: ValidationError[];   // field-level mismatches
  warnings: ValidationWarning[]; // undocumented status codes, missing schemas
}
```

### `validator.validateRequest(path, method, payload, options?)`

Validates a request body payload against the spec's `requestBody` schema.

```typescript
const result = validator.validateRequest('/v1/pets', 'POST', {
  name: 'Fido',
  tag: 'dog',
});
```

### Per-call options

Override the constructor's `strict` option per call:

```typescript
validator.validateResponse(path, method, status, payload, { strict: false });
```

## Errors and Warnings

### Errors

Returned when the payload doesn't match the schema:

```typescript
{
  path: '/id',                    // JSON pointer to the field
  message: 'must be integer',     // human-readable
  keyword: 'type',                // AJV keyword
  expected: 'integer',            // what the spec says
  received: 'string',             // what the payload has
}
```

### Warnings

Returned when the validator can't fully validate — the payload isn't wrong, but it's not contract-tested either:

| Type | When |
|------|------|
| `UNMATCHED_STATUS` | Status code not documented in the spec |
| `MISSING_SCHEMA` | No schema defined for this path/method/status |
| `EMPTY_SPEC_RESPONSE` | Response exists but has no `content` (e.g., 204) |

## OpenAPI Support

- **OpenAPI 3.0** — `nullable` fields normalized to 3.1 format automatically
- **OpenAPI 3.1** — native JSON Schema Draft 2020-12
- **$ref resolution** — nested, deeply nested, components referencing components
- **Composition** — `oneOf`, `anyOf`, `allOf` with full validation
- **Discriminator** — `discriminator.propertyName` support
- **Strict mode** — `additionalProperties: false` enforced by default

### Known Limitation

Strict mode (`additionalProperties: false`) can conflict with `allOf` schemas. When `allOf` branches define different properties, each branch rejects the other's properties as "additional." Use `{ strict: false }` for endpoints that use `allOf` composition, or define `additionalProperties` explicitly in your spec.

## Design Decisions

- **JSON only** — no YAML parsing, no URL fetching. Consumers handle I/O.
- **Strict by default** — if the spec is the source of truth, mocks should match it exactly.
- **Warnings, not silence** — undocumented status codes and missing schemas are surfaced, never silently skipped.
- **Parse once, validate many** — the `init()` step is expensive (dereferencing, normalization, path compilation). Validation calls are fast.

## License

MIT
