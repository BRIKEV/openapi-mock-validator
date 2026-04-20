import { describe, it, expect } from 'vitest';
import { OpenAPIMockValidator } from '../src/validator.js';
import petstore from './fixtures/petstore-3.0.json';

describe('OpenAPIMockValidator', () => {
  describe('constructor', () => {
    it('throws if spec is missing openapi field', () => {
      expect(() => new OpenAPIMockValidator({} as never)).toThrow();
    });

    it('throws if spec has openapi 2.x', () => {
      expect(() => new OpenAPIMockValidator({ openapi: '2.0', paths: {} } as never)).toThrow();
    });

    it('throws if spec has no paths', () => {
      expect(() => new OpenAPIMockValidator({ openapi: '3.0.0' } as never)).toThrow();
    });

    it('accepts a valid 3.0 spec', () => {
      const validator = new OpenAPIMockValidator(petstore as never);
      expect(validator).toBeDefined();
    });
  });

  describe('init', () => {
    it('initializes without errors for valid spec', async () => {
      const validator = new OpenAPIMockValidator(petstore as never);
      await expect(validator.init()).resolves.toBeUndefined();
    });

    it('throws if methods are called before init', () => {
      const validator = new OpenAPIMockValidator(petstore as never);
      expect(() => validator.matchPath('/v1/pets', 'get')).toThrow(/init/i);
    });
  });

  describe('matchPath (via validator)', () => {
    it('delegates to compiled path matchers', async () => {
      const validator = new OpenAPIMockValidator(petstore as never);
      await validator.init();
      const result = validator.matchPath('/v1/pets/123', 'get');
      expect(result).toEqual({ path: '/v1/pets/{petId}', params: { petId: '123' } });
    });

    it('returns null for unmatched paths', async () => {
      const validator = new OpenAPIMockValidator(petstore as never);
      await validator.init();
      const result = validator.matchPath('/v1/unknown', 'get');
      expect(result).toBeNull();
    });
  });

  describe('default strict option', () => {
    it('defaults to strict: true', async () => {
      const validator = new OpenAPIMockValidator(petstore as never);
      await validator.init();
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 1,
        name: 'Fido',
        extraField: 'should fail',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
    });
  });

  describe('strict: false option', () => {
    it('allows extra fields when strict is false', async () => {
      const validator = new OpenAPIMockValidator(petstore as never, { strict: false });
      await validator.init();
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 1,
        name: 'Fido',
        extraField: 'should pass',
      });
      expect(result.valid).toBe(true);
    });
  });
});

describe('normalizeAllSchemas — non-JSON content types', () => {
  // `exclusiveMinimum: true + minimum: 5` is a 3.0-only form that normalizeSpec
  // rewrites to 3.1's `exclusiveMinimum: 5`. It is a discriminating transform:
  // if normalization runs, value 5 is rejected; if it does not, Ajv 2020 in
  // strict:false silently ignores the boolean form and value 5 is accepted.

  const discriminatingResponseSpec = {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
    paths: {
      '/widget': {
        get: {
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/xml': {
                  schema: { type: 'number', minimum: 5, exclusiveMinimum: true },
                },
              },
            },
          },
        },
      },
    },
  };

  const discriminatingRequestSpec = {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
    paths: {
      '/upload': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['count'],
                  properties: {
                    count: { type: 'number', minimum: 5, exclusiveMinimum: true },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };

  it('normalizes response schemas under non-JSON content types', async () => {
    const validator = new OpenAPIMockValidator(discriminatingResponseSpec as never);
    await validator.init();

    // Value 5 violates exclusiveMinimum:5 (post-normalization). If normalization
    // did not run, Ajv would accept 5 as >= minimum:5.
    const boundary = validator.validateResponse('/widget', 'get', 200, 5, {
      contentType: 'application/xml',
    });
    expect(boundary.valid).toBe(false);
    expect(boundary.errors.some((e) => e.keyword === 'exclusiveMinimum')).toBe(true);

    // Sanity: a value strictly greater than 5 passes.
    const above = validator.validateResponse('/widget', 'get', 200, 6, {
      contentType: 'application/xml',
    });
    expect(above.valid).toBe(true);
  });

  it('normalizes request body schemas under non-JSON content types', async () => {
    const validator = new OpenAPIMockValidator(discriminatingRequestSpec as never);
    await validator.init();

    const boundary = validator.validateRequest('/upload', 'post', { count: 5 }, {
      contentType: 'multipart/form-data',
    });
    expect(boundary.valid).toBe(false);
    expect(boundary.errors.some((e) => e.keyword === 'exclusiveMinimum')).toBe(true);

    const above = validator.validateRequest('/upload', 'post', { count: 6 }, {
      contentType: 'multipart/form-data',
    });
    expect(above.valid).toBe(true);
  });
});
