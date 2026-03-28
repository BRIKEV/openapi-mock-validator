# openapi-mock-validator

Validate JSON payloads against OpenAPI 3.0/3.1 specs. Catch mock drift before it hits production.

## Purpose

Frontend teams write mock responses in tests that drift from reality over time. Fields get renamed, removed, or added in the API but mocks stay frozen. Tests pass, code ships, and the app breaks in production.

This package validates mock payloads against the OpenAPI spec — the source of truth. No YAML parsing, no URL fetching — consumers handle I/O, this package handles validation.

## Install

npm install openapi-mock-validator

## Usage

import { OpenAPIMockValidator } from 'openapi-mock-validator';

// Consumers load the spec themselves (fetch, readFile, etc.)
const spec = JSON.parse(fs.readFileSync('./openapi.json', 'utf-8'));

const validator = new OpenAPIMockValidator(spec);
await validator.init();

// Match a mock URL to a spec path
const match = validator.matchPath('/v1/orders/abc-123/status', 'GET');
// { path: '/v1/orders/{id}/status', params: { id: 'abc-123' } }

// Validate mock response against the spec
const result = validator.validateResponse(match.path, 'GET', 200, mockPayload);
// { valid: false, errors: [...], warnings: [...] }

// Validate request body
const reqResult = validator.validateRequest('/v1/orders', 'POST', requestBody);

## Options

const validator = new OpenAPIMockValidator(spec, { strict: false });
// strict (default: true) — reject additional properties not in spec

// Can also override per call:
validator.validateResponse(path, method, status, payload, { strict: false });

## OpenAPI Support

- OpenAPI 3.0 — nullable fields normalized automatically
- OpenAPI 3.1 — native JSON Schema Draft 2020-12
- Full $ref resolution (nested, circular)
- oneOf / anyOf / allOf composition
- discriminator support

## License

MIT
