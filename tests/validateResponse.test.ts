import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAPIMockValidator } from '../src/validator.js';
import petstore from './fixtures/petstore-3.0.json';

describe('validateResponse', () => {
  let validator: OpenAPIMockValidator;

  beforeAll(async () => {
    validator = new OpenAPIMockValidator(petstore as never);
    await validator.init();
  });

  describe('valid payloads', () => {
    it('validates a correct pet object', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 1,
        name: 'Fido',
        tag: null,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('validates a correct pet list', () => {
      const result = validator.validateResponse('/v1/pets', 'get', 200, [
        { id: 1, name: 'Fido' },
        { id: 2, name: 'Rex', tag: 'dog' },
      ]);
      expect(result.valid).toBe(true);
    });
  });

  describe('type errors', () => {
    it('catches wrong type for id (string instead of integer)', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 'not-a-number',
        name: 'Fido',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].keyword).toBe('type');
      expect(result.errors[0].path).toBe('response.id');
    });

    it('catches wrong type for name (number instead of string)', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 1,
        name: 42,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].keyword).toBe('type');
    });
  });

  describe('missing required fields', () => {
    it('catches missing required "name" field', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('catches missing required "id" field', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        name: 'Fido',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });
  });

  describe('additional properties (strict)', () => {
    it('rejects extra fields by default', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'get', 200, {
        id: 1,
        name: 'Fido',
        unknownField: 'oops',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
    });

    it('allows extra fields with strict: false override', () => {
      const result = validator.validateResponse(
        '/v1/pets/{petId}',
        'get',
        200,
        { id: 1, name: 'Fido', unknownField: 'ok' },
        { strict: false },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('warnings', () => {
    it('warns on undocumented status code', () => {
      const result = validator.validateResponse('/v1/pets', 'get', 500, { error: 'server error' });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('UNMATCHED_STATUS');
    });

    it('warns on empty response (no content)', () => {
      const result = validator.validateResponse('/v1/pets/{petId}', 'delete', 204, null);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('EMPTY_SPEC_RESPONSE');
    });
  });

  describe('array validation', () => {
    it('rejects non-array when spec expects array', () => {
      const result = validator.validateResponse('/v1/pets', 'get', 200, { notAnArray: true });
      expect(result.valid).toBe(false);
      expect(result.errors[0].keyword).toBe('type');
    });

    it('validates items inside arrays', () => {
      const result = validator.validateResponse('/v1/pets', 'get', 200, [
        { id: 'bad', name: 'Fido' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain('[0]');
    });
  });
});

describe('validateResponse — content-type support', () => {
  const imageSpec = {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
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

  const wildcardSpec = {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
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

  it('returns valid with no warnings for binary content-type mismatch (acceptance #1)', async () => {
    const validator = new OpenAPIMockValidator(imageSpec as never);
    await validator.init();
    const result = validator.validateResponse('/qr', 'get', 200, 'fake-png-bytes', {
      contentType: 'image/png',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('resolves family wildcard image/* (acceptance #2 & #5)', async () => {
    const validator = new OpenAPIMockValidator(wildcardSpec as never);
    await validator.init();
    const result = validator.validateResponse('/qr', 'get', 200, 'fake-png-bytes', {
      contentType: 'image/png',
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('emits MISSING_SCHEMA when JSON requested but spec only has image (acceptance #3)', async () => {
    const validator = new OpenAPIMockValidator(imageSpec as never);
    await validator.init();
    const result = validator.validateResponse('/qr', 'get', 200, { url: 'x' }, {
      contentType: 'application/json',
    });
    expect(result.valid).toBe(true); // no schema means no validation, valid but warned
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
  });

  it('defaults to application/json when contentType is omitted (acceptance #4)', async () => {
    const validator = new OpenAPIMockValidator(imageSpec as never);
    await validator.init();
    const result = validator.validateResponse('/qr', 'get', 200, { url: 'x' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
    expect(result.warnings[0].message).toContain('application/json');
  });
});
