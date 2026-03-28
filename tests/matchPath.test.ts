import { describe, it, expect } from 'vitest';
import { compilePaths, matchUrl } from '../src/matchPath.js';

const specPaths: Record<string, Record<string, unknown>> = {
  '/v1/pets': { get: {}, post: {} },
  '/v1/pets/{petId}': { get: {}, put: {}, delete: {} },
  '/v1/pets/{petId}/toys': { get: {} },
  '/v1/pets/{petId}/toys/{toyId}': { get: {}, delete: {} },
  '/v1/orders/pending': { get: {} },
  '/v1/orders/{orderId}': { get: {}, put: {} },
  '/v1/orders/{orderId}/{action}': { post: {} },
};

describe('compilePaths', () => {
  it('compiles all spec paths into matchers', () => {
    const compiled = compilePaths(specPaths);
    expect(compiled).toHaveLength(7);
  });

  it('sorts by specificity (fewer params first)', () => {
    const compiled = compilePaths(specPaths);
    const paths = compiled.map((c) => c.specPath);
    const pendingIdx = paths.indexOf('/v1/orders/pending');
    const orderIdIdx = paths.indexOf('/v1/orders/{orderId}');
    const actionIdx = paths.indexOf('/v1/orders/{orderId}/{action}');
    expect(pendingIdx).toBeLessThan(orderIdIdx);
    expect(orderIdIdx).toBeLessThan(actionIdx);
  });
});

describe('matchUrl', () => {
  const compiled = compilePaths(specPaths);

  it('matches an exact path with no params', () => {
    const result = matchUrl(compiled, '/v1/pets', 'get');
    expect(result).toEqual({ path: '/v1/pets', params: {} });
  });

  it('matches a path with one param', () => {
    const result = matchUrl(compiled, '/v1/pets/abc-123', 'get');
    expect(result).toEqual({ path: '/v1/pets/{petId}', params: { petId: 'abc-123' } });
  });

  it('matches a path with multiple params', () => {
    const result = matchUrl(compiled, '/v1/pets/abc-123/toys/toy-456', 'get');
    expect(result).toEqual({
      path: '/v1/pets/{petId}/toys/{toyId}',
      params: { petId: 'abc-123', toyId: 'toy-456' },
    });
  });

  it('prefers literal segments over params (specificity)', () => {
    const result = matchUrl(compiled, '/v1/orders/pending', 'get');
    expect(result).toEqual({ path: '/v1/orders/pending', params: {} });
  });

  it('falls back to param path when literal does not match method', () => {
    const result = matchUrl(compiled, '/v1/orders/pending', 'put');
    expect(result).toEqual({ path: '/v1/orders/{orderId}', params: { orderId: 'pending' } });
  });

  it('normalizes trailing slashes', () => {
    const result = matchUrl(compiled, '/v1/pets/', 'get');
    expect(result).toEqual({ path: '/v1/pets', params: {} });
  });

  it('strips query strings before matching', () => {
    const result = matchUrl(compiled, '/v1/pets?page=1&limit=10', 'get');
    expect(result).toEqual({ path: '/v1/pets', params: {} });
  });

  it('returns null for no matching path', () => {
    const result = matchUrl(compiled, '/v1/unknown', 'get');
    expect(result).toBeNull();
  });

  it('returns null when path matches but method does not exist', () => {
    const result = matchUrl(compiled, '/v1/pets', 'delete');
    expect(result).toBeNull();
  });

  it('matches methods case-insensitively', () => {
    const result = matchUrl(compiled, '/v1/pets', 'GET');
    expect(result).toEqual({ path: '/v1/pets', params: {} });
  });
});
