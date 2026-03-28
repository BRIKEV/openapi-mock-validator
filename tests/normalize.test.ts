import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/normalize.js';

describe('normalizeSpec', () => {
  describe('3.0 → 3.1 nullable conversion', () => {
    it('converts { type: "string", nullable: true } to { type: ["string", "null"] }', () => {
      const schema = { type: 'string', nullable: true };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({ type: ['string', 'null'] });
    });

    it('converts { type: "integer", nullable: true } to { type: ["integer", "null"] }', () => {
      const schema = { type: 'integer', nullable: true };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({ type: ['integer', 'null'] });
    });

    it('converts { type: "object", nullable: true, properties } keeping properties', () => {
      const schema = {
        type: 'object',
        nullable: true,
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({
        type: ['object', 'null'],
        properties: { name: { type: 'string' } },
        required: ['name'],
      });
    });

    it('does not modify schema without nullable', () => {
      const schema = { type: 'string' };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({ type: 'string' });
    });
  });

  describe('3.0 → 3.1 nullable with composition', () => {
    it('converts nullable + oneOf by adding null type branch', () => {
      const schema = {
        nullable: true,
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
          { type: 'null' },
        ],
      });
    });

    it('converts nullable + anyOf by adding null type branch', () => {
      const schema = {
        nullable: true,
        anyOf: [
          { type: 'string' },
          { type: 'number' },
        ],
      };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'null' },
        ],
      });
    });
  });

  describe('3.0 → 3.1 exclusiveMinimum/Maximum conversion', () => {
    it('converts { exclusiveMinimum: true, minimum: 5 } to { exclusiveMinimum: 5 }', () => {
      const schema = { type: 'number', exclusiveMinimum: true, minimum: 5 };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({ type: 'number', exclusiveMinimum: 5 });
    });

    it('converts { exclusiveMaximum: true, maximum: 10 } to { exclusiveMaximum: 10 }', () => {
      const schema = { type: 'number', exclusiveMaximum: true, maximum: 10 };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({ type: 'number', exclusiveMaximum: 10 });
    });

    it('keeps minimum when exclusiveMinimum is false', () => {
      const schema = { type: 'number', exclusiveMinimum: false, minimum: 5 };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({ type: 'number', minimum: 5 });
    });
  });

  describe('3.1 passthrough', () => {
    it('does not modify 3.1 schemas', () => {
      const schema = { type: ['string', 'null'] };
      const result = normalizeSpec(schema, '3.1.0');
      expect(result).toEqual({ type: ['string', 'null'] });
    });

    it('leaves 3.1 exclusiveMinimum as-is', () => {
      const schema = { type: 'number', exclusiveMinimum: 5 };
      const result = normalizeSpec(schema, '3.1.0');
      expect(result).toEqual({ type: 'number', exclusiveMinimum: 5 });
    });
  });

  describe('recursive normalization', () => {
    it('normalizes nested properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', nullable: true },
          age: { type: 'integer' },
        },
      };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          age: { type: 'integer' },
        },
      });
    });

    it('normalizes items in arrays', () => {
      const schema = {
        type: 'array',
        items: { type: 'string', nullable: true },
      };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({
        type: 'array',
        items: { type: ['string', 'null'] },
      });
    });

    it('normalizes schemas inside allOf branches', () => {
      const schema = {
        allOf: [
          { type: 'object', properties: { a: { type: 'string', nullable: true } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      };
      const result = normalizeSpec(schema, '3.0.0');
      expect(result).toEqual({
        allOf: [
          { type: 'object', properties: { a: { type: ['string', 'null'] } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      });
    });
  });
});
