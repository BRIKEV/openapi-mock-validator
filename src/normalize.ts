type Schema = Record<string, unknown>;

export function normalizeSpec(schema: Schema, openapiVersion: string): Schema {
  if (!openapiVersion.startsWith('3.0')) {
    return schema;
  }
  return normalizeSchema(structuredClone(schema));
}

function normalizeSchema(schema: Schema): Schema {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  // Handle nullable with composition (oneOf/anyOf)
  if (schema.nullable === true) {
    if (Array.isArray(schema.oneOf)) {
      const branches = (schema.oneOf as Schema[]).map(normalizeSchema);
      branches.push({ type: 'null' });
      const result: Schema = { ...schema, oneOf: branches };
      delete result.nullable;
      return result;
    }
    if (Array.isArray(schema.anyOf)) {
      const branches = (schema.anyOf as Schema[]).map(normalizeSchema);
      branches.push({ type: 'null' });
      const result: Schema = { ...schema, anyOf: branches };
      delete result.nullable;
      return result;
    }
    // Simple nullable: { type: T, nullable: true } → { type: [T, "null"] }
    if (typeof schema.type === 'string') {
      const result: Schema = { ...schema, type: [schema.type, 'null'] };
      delete result.nullable;
      return normalizeChildren(result);
    }
  }

  // Handle exclusiveMinimum boolean (3.0 style)
  if (schema.exclusiveMinimum === true && schema.minimum !== undefined) {
    schema.exclusiveMinimum = schema.minimum;
    delete schema.minimum;
  } else if (schema.exclusiveMinimum === false) {
    delete schema.exclusiveMinimum;
  }

  // Handle exclusiveMaximum boolean (3.0 style)
  if (schema.exclusiveMaximum === true && schema.maximum !== undefined) {
    schema.exclusiveMaximum = schema.maximum;
    delete schema.maximum;
  } else if (schema.exclusiveMaximum === false) {
    delete schema.exclusiveMaximum;
  }

  return normalizeChildren(schema);
}

function normalizeChildren(schema: Schema): Schema {
  // Normalize properties
  if (schema.properties && typeof schema.properties === 'object') {
    const props = schema.properties as Record<string, Schema>;
    for (const key of Object.keys(props)) {
      props[key] = normalizeSchema(props[key]);
    }
  }

  // Normalize items
  if (schema.items && typeof schema.items === 'object') {
    schema.items = normalizeSchema(schema.items as Schema);
  }

  // Normalize composition branches
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword] = (schema[keyword] as Schema[]).map(normalizeSchema);
    }
  }

  // Normalize additionalProperties if it's a schema
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    schema.additionalProperties = normalizeSchema(schema.additionalProperties as Schema);
  }

  return schema;
}
