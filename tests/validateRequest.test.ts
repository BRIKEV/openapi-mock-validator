import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAPIMockValidator } from '../src/validator.js';
import petstore from './fixtures/petstore-3.0.json';

describe('validateRequest', () => {
  let validator: OpenAPIMockValidator;

  beforeAll(async () => {
    validator = new OpenAPIMockValidator(petstore as never);
    await validator.init();
  });

  describe('valid payloads', () => {
    it('validates a correct request body', () => {
      const result = validator.validateRequest('/v1/pets', 'post', {
        name: 'Fido',
        tag: 'dog',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates with only required fields', () => {
      const result = validator.validateRequest('/v1/pets', 'post', {
        name: 'Fido',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('type errors', () => {
    it('catches wrong type for name', () => {
      const result = validator.validateRequest('/v1/pets', 'post', {
        name: 123,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].keyword).toBe('type');
    });
  });

  describe('missing required fields', () => {
    it('catches missing required "name" field', () => {
      const result = validator.validateRequest('/v1/pets', 'post', {
        tag: 'dog',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });
  });

  describe('additional properties (strict)', () => {
    it('rejects extra fields by default', () => {
      const result = validator.validateRequest('/v1/pets', 'post', {
        name: 'Fido',
        unknownField: 'oops',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
    });

    it('allows extra fields with strict: false', () => {
      const result = validator.validateRequest(
        '/v1/pets',
        'post',
        { name: 'Fido', unknownField: 'ok' },
        { strict: false },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('warnings', () => {
    it('warns when endpoint has no requestBody defined', () => {
      const result = validator.validateRequest('/v1/pets', 'get', { data: 'test' });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('MISSING_SCHEMA');
    });
  });
});
