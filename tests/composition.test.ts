import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAPIMockValidator } from '../src/validator.js';
import composition from './fixtures/composition.json';

describe('composition validation', () => {
  let validator: OpenAPIMockValidator;
  let lenientValidator: OpenAPIMockValidator;

  beforeAll(async () => {
    validator = new OpenAPIMockValidator(composition as never);
    await validator.init();
    lenientValidator = new OpenAPIMockValidator(composition as never, { strict: false });
    await lenientValidator.init();
  });

  describe('oneOf (payment methods)', () => {
    it('validates card payment', () => {
      const result = validator.validateRequest('/v1/payments', 'post', {
        type: 'card',
        cardNumber: '4111111111111111',
        cvv: '123',
      });
      expect(result.valid).toBe(true);
    });

    it('validates bank payment', () => {
      const result = validator.validateRequest('/v1/payments', 'post', {
        type: 'bank',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects payload matching no branch', () => {
      const result = validator.validateRequest('/v1/payments', 'post', {
        type: 'crypto',
        walletAddress: '0x123',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects payload matching both branches', () => {
      // With strict mode, additionalProperties:false is added per branch.
      // A payload missing the required discriminator field cannot satisfy oneOf.
      const result = validator.validateRequest('/v1/payments', 'post', {
        cardNumber: '4111111111111111',
        iban: 'DE89370400440532013000',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('anyOf (product types)', () => {
    it('validates a physical product', () => {
      const result = validator.validateResponse('/v1/products', 'get', 200, [
        { id: 1, name: 'Widget', price: 9.99 },
      ]);
      expect(result.valid).toBe(true);
    });

    it('validates a subscription product', () => {
      const result = validator.validateResponse('/v1/products', 'get', 200, [
        { id: 2, name: 'Premium', plan: 'monthly' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('validates mixed product types in array', () => {
      const result = validator.validateResponse('/v1/products', 'get', 200, [
        { id: 1, name: 'Widget', price: 9.99 },
        { id: 2, name: 'Premium', plan: 'monthly' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('rejects item matching no branch', () => {
      const result = validator.validateResponse('/v1/products', 'get', 200, [
        { id: 1, name: 'Widget' },
      ]);
      expect(result.valid).toBe(false);
    });
  });

  describe('allOf (merged user properties)', () => {
    it('validates when all branches are satisfied', () => {
      // Use lenientValidator: strict mode adds additionalProperties:false per branch,
      // which breaks allOf when branches have different property sets.
      const result = lenientValidator.validateResponse('/v1/users/{userId}', 'get', 200, {
        id: 1,
        email: 'test@example.com',
        name: 'John',
        avatar: null,
      });
      expect(result.valid).toBe(true);
    });

    it('rejects when required field from first branch is missing', () => {
      const result = lenientValidator.validateResponse('/v1/users/{userId}', 'get', 200, {
        id: 1,
        name: 'John',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects when required field from second branch is missing', () => {
      const result = lenientValidator.validateResponse('/v1/users/{userId}', 'get', 200, {
        id: 1,
        email: 'test@example.com',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('validates merged properties in strict mode', () => {
      const result = validator.validateResponse('/v1/users/{userId}', 'get', 200, {
        id: 1,
        email: 'test@example.com',
        name: 'John',
        avatar: null,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('nullable + oneOf (3.0 normalization)', () => {
    it('validates non-null matching payload', () => {
      const result = lenientValidator.validateResponse('/v1/nullable-response', 'get', 200, {
        data: 'hello',
      });
      expect(result.valid).toBe(true);
    });

    it('validates null payload', () => {
      const result = lenientValidator.validateResponse('/v1/nullable-response', 'get', 200, null);
      expect(result.valid).toBe(true);
    });

    it('rejects payload matching no branch and not null', () => {
      const result = lenientValidator.validateResponse('/v1/nullable-response', 'get', 200, {
        unrelated: 'field',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('nested composition (allOf containing oneOf)', () => {
    it('validates typeA variant', () => {
      const result = lenientValidator.validateResponse('/v1/nested-composition', 'get', 200, {
        id: 1,
        kind: 'typeA',
        valueA: 'hello',
      });
      expect(result.valid).toBe(true);
    });

    it('validates typeB variant', () => {
      const result = lenientValidator.validateResponse('/v1/nested-composition', 'get', 200, {
        id: 2,
        kind: 'typeB',
        valueB: 42,
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing id from allOf base', () => {
      const result = lenientValidator.validateResponse('/v1/nested-composition', 'get', 200, {
        kind: 'typeA',
        valueA: 'hello',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid kind enum value', () => {
      const result = lenientValidator.validateResponse('/v1/nested-composition', 'get', 200, {
        id: 1,
        kind: 'typeC',
        valueA: 'hello',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('enum validation', () => {
    it('validates correct enum value in response', () => {
      const result = validator.validateResponse('/v1/payments', 'post', 201, {
        id: 'pay-123',
        status: 'pending',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid enum value', () => {
      const result = validator.validateResponse('/v1/payments', 'post', 201, {
        id: 'pay-123',
        status: 'cancelled',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].keyword).toBe('enum');
    });
  });

  describe('oneOf with allOf branches (strict mode)', () => {
    it('validates plan item without false positive', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'plan',
          value: {
            name: 'Unlimited Plan',
            sku: 'plan-unlimited',
            periodicity: 'monthly',
            metadata: { recurrence: 'monthly' },
          },
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates trip item without false positive', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'trip',
          value: {
            name: 'Spain',
            sku: 'trip-spain',
            days: 7,
            metadata: { days: 7 },
          },
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates credit-recharge item without false positive', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'credit-recharge',
          value: {
            name: 'Credit Recharge 500',
            sku: 'credit-recharge-500',
          },
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates mixed cart items without false positive', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'plan',
          value: {
            name: 'Unlimited Plan',
            sku: 'plan-unlimited',
            periodicity: 'monthly',
            metadata: { recurrence: 'monthly' },
          },
        },
        {
          type: 'trip',
          value: {
            name: 'Spain',
            sku: 'trip-spain',
            days: 7,
            metadata: { days: 7 },
          },
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('still rejects invalid type value in strict mode', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'unknown',
          value: { name: 'Test', sku: 'test' },
        },
      ]);
      expect(result.valid).toBe(false);
    });

    it('still rejects extra properties on the item in strict mode', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'plan',
          value: { name: 'Plan', sku: 'plan-1', periodicity: 'monthly', metadata: { recurrence: 'monthly' } },
          extraField: 'should not be here',
        },
      ]);
      expect(result.valid).toBe(false);
    });

    it('still rejects missing required fields in strict mode', () => {
      const result = validator.validateRequest('/v1/cart-items', 'post', [
        {
          type: 'trip',
          value: { name: 'Spain' },
        },
      ]);
      expect(result.valid).toBe(false);
    });
  });
});
