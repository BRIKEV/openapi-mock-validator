import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAPIMockValidator } from '../src/validator.js';
import petstore30 from './fixtures/petstore-3.0.json';
import petstore31 from './fixtures/petstore-3.1.json';

describe('cross-version: 3.0 and 3.1 produce same results', () => {
  let v30: OpenAPIMockValidator;
  let v31: OpenAPIMockValidator;

  beforeAll(async () => {
    v30 = new OpenAPIMockValidator(petstore30 as never, { strict: false });
    await v30.init();
    v31 = new OpenAPIMockValidator(petstore31 as never, { strict: false });
    await v31.init();
  });

  it('both accept valid pet', () => {
    const payload = { id: 1, name: 'Fido', tag: null };
    const r30 = v30.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    const r31 = v31.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    expect(r30.valid).toBe(true);
    expect(r31.valid).toBe(true);
  });

  it('both accept pet with string tag', () => {
    const payload = { id: 1, name: 'Fido', tag: 'dog' };
    const r30 = v30.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    const r31 = v31.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    expect(r30.valid).toBe(true);
    expect(r31.valid).toBe(true);
  });

  it('both reject missing required name', () => {
    const payload = { id: 1 };
    const r30 = v30.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    const r31 = v31.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    expect(r30.valid).toBe(false);
    expect(r31.valid).toBe(false);
  });

  it('both reject wrong type', () => {
    const payload = { id: 'bad', name: 'Fido' };
    const r30 = v30.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    const r31 = v31.validateResponse('/v1/pets/{petId}', 'get', 200, payload);
    expect(r30.valid).toBe(false);
    expect(r31.valid).toBe(false);
  });

  it('both warn on undocumented status', () => {
    const r30 = v30.validateResponse('/v1/pets', 'get', 500, {});
    const r31 = v31.validateResponse('/v1/pets', 'get', 500, {});
    expect(r30.warnings[0].type).toBe('UNMATCHED_STATUS');
    expect(r31.warnings[0].type).toBe('UNMATCHED_STATUS');
  });

  it('both accept valid request body', () => {
    const payload = { name: 'Fido', tag: 'dog' };
    const r30 = v30.validateRequest('/v1/pets', 'post', payload);
    const r31 = v31.validateRequest('/v1/pets', 'post', payload);
    expect(r30.valid).toBe(true);
    expect(r31.valid).toBe(true);
  });
});
