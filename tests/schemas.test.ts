import { describe, it, expect } from 'vitest';
import { extractResponseSchema, extractRequestSchema, isBinaryContentType } from '../src/schemas.js';
import type { OpenAPISpec } from '../src/types.js';
import petstore from './fixtures/petstore-3.0.json';

const spec = petstore as unknown as OpenAPISpec;

describe('extractResponseSchema', () => {
  it('extracts schema for a valid path/method/status', () => {
    const result = extractResponseSchema(spec, '/v1/pets', 'get', 200);
    expect(result.schema).toBeDefined();
    expect(result.schema!.type).toBe('array');
    expect(result.warnings).toEqual([]);
  });

  it('extracts schema for POST 201', () => {
    const result = extractResponseSchema(spec, '/v1/pets', 'post', 201);
    expect(result.schema).toBeDefined();
    expect(result.schema!.type).toBe('object');
    expect(result.warnings).toEqual([]);
  });

  it('returns UNMATCHED_STATUS warning for undocumented status code', () => {
    const result = extractResponseSchema(spec, '/v1/pets', 'get', 500);
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('UNMATCHED_STATUS');
  });

  it('returns EMPTY_SPEC_RESPONSE warning when response has no content', () => {
    const result = extractResponseSchema(spec, '/v1/pets/{petId}', 'delete', 204);
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('EMPTY_SPEC_RESPONSE');
  });

  it('returns MISSING_SCHEMA warning when content exists but has no schema', () => {
    const specWithNoSchema: OpenAPISpec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {},
                },
              },
            },
          },
        },
      },
    };
    const result = extractResponseSchema(specWithNoSchema, '/test', 'get', 200);
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
  });
});

describe('extractRequestSchema', () => {
  it('extracts request body schema for POST', () => {
    const result = extractRequestSchema(spec, '/v1/pets', 'post');
    expect(result.schema).toBeDefined();
    expect(result.schema!.type).toBe('object');
    expect(result.warnings).toEqual([]);
  });

  it('returns MISSING_SCHEMA warning when no requestBody', () => {
    const result = extractRequestSchema(spec, '/v1/pets', 'get');
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
  });
});

describe('isBinaryContentType', () => {
  it('returns true for image/* types', () => {
    expect(isBinaryContentType('image/png')).toBe(true);
    expect(isBinaryContentType('image/jpeg')).toBe(true);
    expect(isBinaryContentType('image/svg+xml')).toBe(true);
  });

  it('returns true for video/* and audio/* types', () => {
    expect(isBinaryContentType('video/mp4')).toBe(true);
    expect(isBinaryContentType('audio/mpeg')).toBe(true);
  });

  it('returns true for application binary types', () => {
    expect(isBinaryContentType('application/octet-stream')).toBe(true);
    expect(isBinaryContentType('application/pdf')).toBe(true);
    expect(isBinaryContentType('application/zip')).toBe(true);
  });

  it('returns false for JSON and text types', () => {
    expect(isBinaryContentType('application/json')).toBe(false);
    expect(isBinaryContentType('application/xml')).toBe(false);
    expect(isBinaryContentType('text/plain')).toBe(false);
    expect(isBinaryContentType('text/html')).toBe(false);
  });
});
