// Interpreted validation: runtime schema compilers using eval violate MV3's CSP.
export function validateSchema(schema: unknown, value: unknown, root: unknown = schema, path = '$', depth = 0): void {
  if (depth > 64) throw new Error('Schema/value nesting exceeds 64 levels');
  if (schema === true) return;
  if (schema === false) throw new Error(`${path}: schema rejects value`);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('schema must be an object or boolean');
  const s = schema as Record<string, any>;
  const allowed = new Set(['$schema', '$id', '$ref', '$defs', 'definitions', 'title', 'description', 'default', 'examples', 'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'anyOf', 'oneOf', 'allOf', 'not', 'minProperties', 'maxProperties']);
  for (const key of Object.keys(s)) if (!allowed.has(key)) throw new Error(`Unsupported JSON Schema keyword: ${key}`);
  const validate = (child: unknown, data: unknown, childPath = path) => validateSchema(child, data, root, childPath, depth + 1);
  const matches = (child: unknown) => { try { validate(child, value); return true; } catch (error) { if (String(error).includes('Unsupported')) throw error; return false; } };
  if (s.$ref !== undefined) {
    if (typeof s.$ref !== 'string' || !s.$ref.startsWith('#/')) throw new Error('Only local JSON Schema references are supported');
    let target: any = root;
    for (const part of s.$ref.slice(2).split('/')) { const key = part.replace(/~1/g, '/').replace(/~0/g, '~'); if (!target || !Object.hasOwn(target, key)) throw new Error('Unresolved schema reference'); target = target[key]; }
    validate(target, value);
  }
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.every((type: unknown) => ['null', 'array', 'object', 'string', 'number', 'integer', 'boolean'].includes(String(type)))) throw new Error('Invalid schema type');
    if (!types.some((type: string) => type === kind || (type === 'integer' && Number.isInteger(value)))) throw new Error(`${path}: expected ${types.join('|')}`);
  }
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
    const keys = Object.keys(aa);
    return keys.length === Object.keys(bb).length && keys.every((key) => Object.hasOwn(bb, key) && equal(aa[key], bb[key]));
  };
  if (s.enum && !s.enum.some((item: unknown) => equal(item, value))) throw new Error(`${path}: value is outside enum`);
  if (Object.hasOwn(s, 'const') && !equal(s.const, value)) throw new Error(`${path}: const mismatch`);
  if (s.anyOf && !s.anyOf.some(matches)) throw new Error(`${path}: no anyOf branch matched`);
  if (s.oneOf && s.oneOf.filter(matches).length !== 1) throw new Error(`${path}: expected exactly one oneOf branch`);
  if (s.allOf) for (const child of s.allOf) validate(child, value);
  if (s.not && matches(s.not)) throw new Error(`${path}: not constraint failed`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (s.minimum !== undefined && value < s.minimum) || (s.maximum !== undefined && value > s.maximum) || (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) || (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) || (s.multipleOf !== undefined && Math.abs(value / s.multipleOf - Math.round(value / s.multipleOf)) > 1e-8)) throw new Error(`${path}: numeric constraint failed`);
  }
  if (typeof value === 'string' && ((s.minLength !== undefined && [...value].length < s.minLength) || (s.maxLength !== undefined && [...value].length > s.maxLength) || (s.pattern !== undefined && !new RegExp(s.pattern).test(value)))) throw new Error(`${path}: string constraint failed`);
  if (Array.isArray(value)) {
    if ((s.minItems !== undefined && value.length < s.minItems) || (s.maxItems !== undefined && value.length > s.maxItems)) throw new Error(`${path}: array length constraint failed`);
    if (s.uniqueItems && value.some((item, index) => value.slice(0, index).some((previous) => equal(previous, item)))) throw new Error(`${path}: duplicate array items`);
    if (Array.isArray(s.items)) throw new Error('Tuple schemas are not supported');
    if (s.items !== undefined) value.forEach((item, index) => validate(s.items, item, `${path}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    const data = value as Record<string, unknown>;
    if ((s.minProperties !== undefined && Object.keys(data).length < s.minProperties) || (s.maxProperties !== undefined && Object.keys(data).length > s.maxProperties)) throw new Error(`${path}: object size constraint failed`);
    for (const key of s.required ?? []) if (!Object.hasOwn(data, key)) throw new Error(`${path}.${key}: required field missing`);
    for (const [key, item] of Object.entries(data)) {
      if (Object.hasOwn(s.properties ?? {}, key)) validate(s.properties[key], item, `${path}.${key}`);
      else if (s.additionalProperties === false) throw new Error(`${path}.${key}: additional property`);
      else if (typeof s.additionalProperties === 'object') validate(s.additionalProperties, item, `${path}.${key}`);
    }
  }
}
