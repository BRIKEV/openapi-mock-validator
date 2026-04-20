import { describe, it, expect } from 'vitest';
import { extractResponseSchema, extractRequestSchema, isBinaryContentType, resolveMediaType } from '../src/schemas.js';
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

describe('resolveMediaType', () => {
  it('returns exact match when content-type is in the spec', () => {
    const content = { 'image/png': { schema: { type: 'string' } } };
    expect(resolveMediaType(content, 'image/png')).toEqual({ schema: { type: 'string' } });
  });

  it('falls back to family wildcard (image/*) when no exact match', () => {
    const content = { 'image/*': { schema: { type: 'string' } } };
    expect(resolveMediaType(content, 'image/png')).toEqual({ schema: { type: 'string' } });
  });

  it('falls back to */* when neither exact nor family match', () => {
    const content = { '*/*': { schema: { type: 'string' } } };
    expect(resolveMediaType(content, 'image/png')).toEqual({ schema: { type: 'string' } });
  });

  it('prefers exact match over wildcard', () => {
    const content = {
      'image/png': { schema: { const: 'exact' } },
      'image/*': { schema: { const: 'family' } },
      '*/*': { schema: { const: 'any' } },
    };
    expect(resolveMediaType(content, 'image/png')).toEqual({ schema: { const: 'exact' } });
  });

  it('prefers family wildcard over */*', () => {
    const content = {
      'image/*': { schema: { const: 'family' } },
      '*/*': { schema: { const: 'any' } },
    };
    expect(resolveMediaType(content, 'image/png')).toEqual({ schema: { const: 'family' } });
  });

  it('returns null when nothing matches', () => {
    const content = { 'application/xml': { schema: {} } };
    expect(resolveMediaType(content, 'image/png')).toBeNull();
  });
});

describe('extractRequestSchema (content-type aware)', () => {
  const specWithMultipart: OpenAPISpec = {
    openapi: '3.0.0',
    paths: {
      '/upload': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string' } } } },
              'application/json': { schema: { type: 'object', properties: { url: { type: 'string' } } } },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };

  it('defaults to application/json when contentType is not passed', () => {
    const result = extractRequestSchema(specWithMultipart, '/upload', 'post');
    expect(result.schema).toEqual({ type: 'object', properties: { url: { type: 'string' } } });
    expect(result.warnings).toEqual([]);
  });

  it('returns schema for exact content-type match', () => {
    const result = extractRequestSchema(specWithMultipart, '/upload', 'post', 'multipart/form-data');
    expect(result.schema).toEqual({ type: 'object', properties: { file: { type: 'string' } } });
    expect(result.warnings).toEqual([]);
  });

  it('silently bypasses binary content-type when no match', () => {
    const result = extractRequestSchema(specWithMultipart, '/upload', 'post', 'image/png');
    expect(result.schema).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('emits MISSING_SCHEMA when non-binary content-type has no match', () => {
    const result = extractRequestSchema(specWithMultipart, '/upload', 'post', 'application/xml');
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
    expect(result.warnings[0].message).toContain('application/xml');
  });
});

describe('extractResponseSchema (content-type aware)', () => {
  const specWithImage: OpenAPISpec = {
    openapi: '3.0.0',
    paths: {
      '/qr': {
        get: {
          responses: {
            '200': {
              description: 'OK',
              content: {
                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
      },
    },
  };

  const specWithImageWildcard: OpenAPISpec = {
    openapi: '3.0.0',
    paths: {
      '/qr': {
        get: {
          responses: {
            '200': {
              description: 'OK',
              content: {
                'image/*': { schema: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
      },
    },
  };

  it('defaults to application/json when contentType is not passed', () => {
    // petstore fixture defines application/json for /v1/pets GET 200
    const result = extractResponseSchema(spec, '/v1/pets', 'get', 200);
    expect(result.schema).toBeDefined();
    expect(result.warnings).toEqual([]);
  });

  it('returns schema for exact content-type match', () => {
    const result = extractResponseSchema(specWithImage, '/qr', 'get', 200, 'image/jpeg');
    expect(result.schema).toEqual({ type: 'string', format: 'binary' });
    expect(result.warnings).toEqual([]);
  });

  it('returns schema for family wildcard match (image/*)', () => {
    const result = extractResponseSchema(specWithImageWildcard, '/qr', 'get', 200, 'image/png');
    expect(result.schema).toEqual({ type: 'string', format: 'binary' });
    expect(result.warnings).toEqual([]);
  });

  it('silently bypasses binary content-type when no match (no warning)', () => {
    // spec declares image/jpeg; consumer sends image/png — no wildcard, but binary so silent
    const result = extractResponseSchema(specWithImage, '/qr', 'get', 200, 'image/png');
    expect(result.schema).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('emits MISSING_SCHEMA when JSON requested but spec only has image', () => {
    const result = extractResponseSchema(specWithImage, '/qr', 'get', 200, 'application/json');
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
    expect(result.warnings[0].message).toContain('application/json');
  });

  it('emits MISSING_SCHEMA when non-binary non-JSON requested and no match', () => {
    const result = extractResponseSchema(specWithImage, '/qr', 'get', 200, 'application/xml');
    expect(result.schema).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
    expect(result.warnings[0].message).toContain('application/xml');
  });
});
