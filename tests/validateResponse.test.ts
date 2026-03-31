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
