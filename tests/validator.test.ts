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
