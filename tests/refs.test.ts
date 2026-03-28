import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAPIMockValidator } from '../src/validator.js';
import complexRefs from './fixtures/complex-refs.json';

describe('$ref resolution', () => {
  let validator: OpenAPIMockValidator;

  beforeAll(async () => {
    validator = new OpenAPIMockValidator(complexRefs as never, { strict: false });
    await validator.init();
  });

  describe('simple $ref', () => {
    it('validates order matching $ref schema', () => {
      const result = validator.validateResponse('/v1/orders', 'get', 200, [
        {
          id: 'ord-1',
          status: 'pending',
          items: [{ product: 'Widget', quantity: 2, price: 9.99 }],
          note: null,
        },
      ]);
      expect(result.valid).toBe(true);
    });

    it('rejects order missing required field from $ref schema', () => {
      const result = validator.validateResponse('/v1/orders', 'post', 201, {
        id: 'ord-1',
        status: 'pending',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });
  });

  describe('nested $ref (component referencing component)', () => {
    it('validates order with nested LineItem refs', () => {
      const result = validator.validateResponse('/v1/orders', 'post', 201, {
        id: 'ord-1',
        status: 'shipped',
        items: [
          { product: 'Widget', quantity: 2, price: 9.99 },
          { product: 'Gadget', quantity: 1, price: 19.99 },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('rejects when nested $ref item has wrong type', () => {
      const result = validator.validateResponse('/v1/orders', 'post', 201, {
        id: 'ord-1',
        status: 'pending',
        items: [{ product: 'Widget', quantity: 'two', price: 9.99 }],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('deeply nested $ref (allOf + nested component refs)', () => {
    it('validates OrderWithCustomer (allOf with $ref to Order + Customer + Address)', () => {
      const result = validator.validateResponse('/v1/orders/{orderId}', 'get', 200, {
        id: 'ord-1',
        status: 'delivered',
        items: [{ product: 'Widget', quantity: 1 }],
        customer: {
          id: 42,
          name: 'Alice',
          address: { street: '123 Main St', city: 'Springfield' },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('rejects when deeply nested Address is invalid', () => {
      const result = validator.validateResponse('/v1/orders/{orderId}', 'get', 200, {
        id: 'ord-1',
        status: 'delivered',
        items: [{ product: 'Widget', quantity: 1 }],
        customer: {
          id: 42,
          name: 'Alice',
          address: { street: '123 Main St' },
        },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects when customer (from second allOf branch) is missing', () => {
      const result = validator.validateResponse('/v1/orders/{orderId}', 'get', 200, {
        id: 'ord-1',
        status: 'delivered',
        items: [{ product: 'Widget', quantity: 1 }],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('$ref in request body', () => {
    it('validates request body using $ref schema', () => {
      const result = validator.validateRequest('/v1/orders', 'post', {
        items: [{ product: 'Widget', quantity: 3 }],
        note: 'Rush order',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid request body from $ref schema', () => {
      const result = validator.validateRequest('/v1/orders', 'post', {
        note: 'No items',
      });
      expect(result.valid).toBe(false);
    });
  });
});
