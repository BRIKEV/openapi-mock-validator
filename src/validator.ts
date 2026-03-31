import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import $RefParser, { type JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { compilePaths, matchUrl } from './matchPath.js';
import { normalizeSpec } from './normalize.js';
import { extractResponseSchema, extractRequestSchema } from './schemas.js';
import type {
  OpenAPISpec,
  ValidatorOptions,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  PathMatch,
  CompiledPath,
} from './types.js';

export class OpenAPIMockValidator {
  private spec: OpenAPISpec;
  private options: Required<ValidatorOptions>;
  private compiledPaths: CompiledPath[] | null = null;
  private initialized = false;

  constructor(spec: OpenAPISpec, options?: ValidatorOptions) {
    if (!spec || typeof spec !== 'object') {
      throw new Error('OpenAPI spec must be an object');
    }
    if (!spec.openapi || typeof spec.openapi !== 'string') {
      throw new Error('OpenAPI spec must have an "openapi" field');
    }
    if (!spec.openapi.startsWith('3.')) {
      throw new Error(`OpenAPI version ${spec.openapi} is not supported. Only 3.x is supported.`);
    }
    if (!spec.paths || typeof spec.paths !== 'object') {
      throw new Error('OpenAPI spec must have a "paths" field');
    }

    this.spec = spec;
    this.options = {
      strict: options?.strict ?? true,
    };
  }

  async init(): Promise<void> {
    // Step 1: Dereference all $refs
    const dereferenced = (await $RefParser.dereference(
      structuredClone(this.spec) as JSONSchema,
    )) as unknown as OpenAPISpec;

    // Step 2: Normalize 3.0 → 3.1 for all schemas in paths
    if (dereferenced.openapi.startsWith('3.0')) {
      this.normalizeAllSchemas(dereferenced);
    }

    this.spec = dereferenced;

    // Step 3: Compile path matchers
    this.compiledPaths = compilePaths(this.spec.paths);

    this.initialized = true;
  }

  matchPath(url: string, method: string): PathMatch | null {
    this.ensureInitialized();
    return matchUrl(this.compiledPaths!, url, method);
  }

  validateResponse(
    path: string,
    method: string,
    status: number,
    payload: unknown,
    options?: ValidatorOptions,
  ): ValidationResult {
    this.ensureInitialized();

    const { schema, warnings } = extractResponseSchema(this.spec, path, method, status);
    if (!schema) {
      return { valid: true, errors: [], warnings };
    }

    const strict = options?.strict ?? this.options.strict;
    return this.validate(schema, payload, strict, warnings);
  }

  validateRequest(
    path: string,
    method: string,
    payload: unknown,
    options?: ValidatorOptions,
  ): ValidationResult {
    this.ensureInitialized();

    const { schema, warnings } = extractRequestSchema(this.spec, path, method);
    if (!schema) {
      return { valid: true, errors: [], warnings };
    }

    const strict = options?.strict ?? this.options.strict;
    return this.validate(schema, payload, strict, warnings);
  }

  private validate(
    schema: Record<string, unknown>,
    payload: unknown,
    strict: boolean,
    existingWarnings: ValidationWarning[],
  ): ValidationResult {
    const schemaToValidate = strict
      ? this.addAdditionalPropertiesFalse(structuredClone(schema))
      : schema;

    // @ts-expect-error -- ajv/dist/2020.js lacks proper type declarations
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    // @ts-expect-error -- ajv-formats type mismatch with Ajv2020
    addFormats(ajv);

    const valid = ajv.validate(schemaToValidate, payload);

    if (valid) {
      return { valid: true, errors: [], warnings: existingWarnings };
    }

    const rawErrors: ValidationError[] = (ajv.errors || []).map((err: Record<string, unknown>) => {
      const params = err.params as Record<string, unknown> | undefined;
      const instancePath = (err.instancePath as string) || '';
      const dotPath = toDotPath(instancePath);

      const error: ValidationError = {
        path: dotPath,
        message: (err.message as string) || 'validation failed',
        keyword: err.keyword as string,
      };

      if (err.keyword === 'required') {
        const missingProp = params?.missingProperty as string;
        error.path = dotPath ? `${dotPath}.${missingProp}` : missingProp;
        error.message = 'missing required property';
      }

      if (err.keyword === 'type') {
        error.expected = String(params?.type);
        error.received = typeof payload === 'object' && payload !== null
          ? typeof getValueAtPath(payload, instancePath)
          : typeof payload;
        error.message = `expected ${error.expected}, got ${error.received}`;
      }

      if (err.keyword === 'enum') {
        const allowed = (params?.allowedValues as unknown[]);
        error.expected = allowed?.join(', ');
        error.message = `must be one of: ${allowed?.map(v => `"${v}"`).join(', ')}`;
      }

      if (err.keyword === 'additionalProperties') {
        const extra = params?.additionalProperty as string;
        error.path = dotPath ? `${dotPath}.${extra}` : extra;
        error.message = 'unexpected property';
      }

      if (err.keyword === 'oneOf') {
        error.message = 'does not match any allowed schema (oneOf)';
      }

      if (err.keyword === 'anyOf') {
        error.message = 'does not match any allowed schema (anyOf)';
      }

      return error;
    });

    // Collapse oneOf/anyOf: if the final error is a oneOf/anyOf keyword,
    // keep only that summary and drop the per-branch sub-errors
    const errors = collapseCompositionErrors(rawErrors);

    return { valid: false, errors, warnings: existingWarnings };
  }

  private addAdditionalPropertiesFalse(schema: Record<string, unknown>): Record<string, unknown> {
    if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
      if (schema.properties && schema.additionalProperties === undefined) {
        schema.additionalProperties = false;
      }
    }

    // Recurse into properties
    if (schema.properties && typeof schema.properties === 'object') {
      for (const value of Object.values(schema.properties as Record<string, Record<string, unknown>>)) {
        if (typeof value === 'object' && value !== null) {
          this.addAdditionalPropertiesFalse(value);
        }
      }
    }

    // Recurse into items
    if (schema.items && typeof schema.items === 'object') {
      this.addAdditionalPropertiesFalse(schema.items as Record<string, unknown>);
    }

    // Recurse into composition keywords
    for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(schema[keyword])) {
        for (const branch of schema[keyword] as Record<string, unknown>[]) {
          this.addAdditionalPropertiesFalse(branch);
        }
      }
    }

    return schema;
  }

  private normalizeAllSchemas(spec: OpenAPISpec): void {
    for (const pathItem of Object.values(spec.paths)) {
      for (const [key, value] of Object.entries(pathItem)) {
        if (key.startsWith('x-') || typeof value !== 'object' || value === null) continue;
        const operation = value as Record<string, unknown>;

        // Normalize response schemas
        const responses = operation.responses as Record<string, Record<string, unknown>> | undefined;
        if (responses) {
          for (const response of Object.values(responses)) {
            const content = response?.content as Record<string, Record<string, unknown>> | undefined;
            if (content?.['application/json']?.schema) {
              content['application/json'].schema = normalizeSpec(
                content['application/json'].schema as Record<string, unknown>,
                spec.openapi,
              );
            }
          }
        }

        // Normalize request body schemas
        const requestBody = operation.requestBody as Record<string, unknown> | undefined;
        if (requestBody) {
          const content = requestBody.content as Record<string, Record<string, unknown>> | undefined;
          if (content?.['application/json']?.schema) {
            content['application/json'].schema = normalizeSpec(
              content['application/json'].schema as Record<string, unknown>,
              spec.openapi,
            );
          }
        }
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Validator not initialized. Call await validator.init() first.');
    }
  }
}

function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path || path === '/') return obj;
  const parts = path.split('/').filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toDotPath(instancePath: string): string {
  if (!instancePath || instancePath === '/') return 'response';
  const parts = instancePath.split('/').filter(Boolean);
  const segments = parts.map((p) => /^\d+$/.test(p) ? `[${p}]` : `.${p}`);
  return `response${segments.join('')}`;
}

function collapseCompositionErrors(errors: ValidationError[]): ValidationError[] {
  if (errors.length <= 1) return errors;

  const last = errors[errors.length - 1];
  if (last.keyword === 'oneOf' || last.keyword === 'anyOf') {
    const prefix = last.path;
    // Keep the composition error itself and any errors NOT under that path
    return errors.filter((e) => {
      if (e === last) return true;
      // Drop sub-errors that are children of the composition path
      return !e.path.startsWith(prefix);
    });
  }

  return errors;
}
