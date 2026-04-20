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
  it('normalizes 3.0 schemas under non-JSON content types', async () => {
    // A 3.0 spec where the image content type has a nullable string schema —
    // after normalization, nullable: true should become type: ['string', 'null'].
    const spec = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0.0' },
      paths: {
        '/file': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'image/jpeg': {
                    schema: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    };

    const validator = new OpenAPIMockValidator(spec as never);
    await validator.init();

    // After init the spec is normalized in place; reach into it via the
    // validator's internal state by validating with the declared content-type.
    // A null payload should now validate as a string|null after normalization.
    const result = validator.validateResponse('/file', 'get', 200, null, {
      contentType: 'image/jpeg',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('also normalizes non-JSON request body schemas', async () => {
    const spec = {
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
                    required: ['name'],
                    properties: {
                      name: { type: 'string', nullable: true },
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

    const validator = new OpenAPIMockValidator(spec as never);
    await validator.init();

    const result = validator.validateRequest('/upload', 'post', { name: null }, {
      contentType: 'multipart/form-data',
    });
    expect(result.valid).toBe(true);
  });
});
