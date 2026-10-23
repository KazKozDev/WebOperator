import { expect, it } from 'vitest';
import { validateSchema } from './bridge-schema';
const schema = { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number', minimum: 0 } }, required: ['title', 'price'], additionalProperties: false } };
it('validates product data, rather than accepting arbitrary JSON', () => {
  expect(() => validateSchema(schema, [{ title: 'Book', price: 12 }])).not.toThrow();
  for (const value of [[{ title: 'Book', price: '12' }], [{ title: 'Book' }], [{ title: 'Book', price: -1 }], [{ title: 'Book', price: 12, invented: true }]]) expect(() => validateSchema(schema, value)).toThrow();
});
it('supports local refs, combinators and constraints', () => {
  const s = { $defs: { name: { type: 'string', minLength: 2 } }, type: 'object', properties: { name: { $ref: '#/$defs/name' }, value: { oneOf: [{ type: 'number' }, { type: 'boolean' }] } }, required: ['name', 'value'] };
  expect(() => validateSchema(s, { name: 'ok', value: true })).not.toThrow();
  expect(() => validateSchema(s, { name: 'x', value: 1 })).toThrow();
  expect(() => validateSchema({ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 })).not.toThrow();
  expect(() => validateSchema({ uniqueItems: true }, [1, 1])).toThrow();
});
it('fails explicitly on unsupported keywords and remote references', () => {
  expect(() => validateSchema({ type: 'string', format: 'email' }, 'user@example.com')).toThrow('Unsupported JSON Schema keyword');
  expect(() => validateSchema({ $ref: 'https://example.com/schema' }, {})).toThrow('Only local');
});
