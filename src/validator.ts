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

interface InternalError extends ValidationError {
  schemaPath: string;
  instancePath: string;
}

export class OpenAPIMockValidator {
  private spec: OpenAPISpec;
  private options: { strict: boolean };
  private compiledPaths: CompiledPath[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Ajv2020 lacks proper type exports
  private ajv: any = null;
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

    // Step 4: Create reusable Ajv instance
    // @ts-expect-error -- ajv/dist/2020.js lacks proper type declarations
    this.ajv = new Ajv2020({ strict: false, allErrors: true });
    // @ts-expect-error -- ajv-formats type mismatch with Ajv2020
    addFormats(this.ajv);

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

    const contentType = options?.contentType ?? 'application/json';
    const { schema, warnings } = extractResponseSchema(this.spec, path, method, status, contentType);
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

    const valid = this.ajv!.validate(schemaToValidate, payload);

    if (valid) {
      return { valid: true, errors: [], warnings: existingWarnings };
    }

    const rawErrors: InternalError[] = (this.ajv!.errors || []).map((err: Record<string, unknown>) => {
      const params = err.params as Record<string, unknown> | undefined;
      const instancePath = (err.instancePath as string) || '';
      const dotPath = toDotPath(instancePath);

      const error: InternalError = {
        path: dotPath,
        message: (err.message as string) || 'validation failed',
        keyword: err.keyword as string,
        schemaPath: (err.schemaPath as string) || '',
        instancePath,
      };

      if (err.keyword === 'required') {
        const missingProp = params?.missingProperty as string;
        error.path = dotPath ? `${dotPath}.${missingProp}` : missingProp;
        error.message = `missing required property "${missingProp}"`;
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
        error.message = `unexpected property "${extra}"`;
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
    const errors = resolveCompositionErrors(rawErrors, schemaToValidate, payload);

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

    // Recurse into oneOf/anyOf branches
    for (const keyword of ['oneOf', 'anyOf']) {
      if (Array.isArray(schema[keyword])) {
        for (const branch of schema[keyword] as Record<string, unknown>[]) {
          this.addAdditionalPropertiesFalse(branch);
        }
      }
    }

    // For allOf: merge sibling properties before recursing so each branch
    // knows about properties defined in other branches. Without this,
    // additionalProperties:false on branch A rejects properties from branch B.
    if (Array.isArray(schema.allOf)) {
      const branches = schema.allOf as Record<string, unknown>[];

      // Collect the union of all property keys across all allOf branches
      const allPropertyKeys = new Set<string>();
      for (const branch of branches) {
        if (branch.properties && typeof branch.properties === 'object') {
          for (const key of Object.keys(branch.properties as Record<string, unknown>)) {
            allPropertyKeys.add(key);
          }
        }
      }

      // Inject empty stubs for missing sibling properties into each branch
      if (allPropertyKeys.size > 0) {
        for (const branch of branches) {
          if (branch.properties && typeof branch.properties === 'object') {
            const props = branch.properties as Record<string, unknown>;
            for (const key of allPropertyKeys) {
              if (!(key in props)) {
                props[key] = {};
              }
            }
          }
        }
      }

      // Now recurse into each branch
      for (const branch of branches) {
        this.addAdditionalPropertiesFalse(branch);
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

function resolveCompositionErrors(
  errors: InternalError[],
  schema: Record<string, unknown>,
  payload: unknown,
): ValidationError[] {
  if (errors.length <= 1) return errors;

  // Find the composition error (last error with keyword oneOf or anyOf)
  const compositionError = findCompositionError(errors);
  if (!compositionError) return errors;

  const keyword = compositionError.keyword; // 'oneOf' or 'anyOf'
  const prefix = compositionError.schemaPath; // e.g. '#/oneOf' or '#/allOf/1/oneOf'

  // Group sub-errors by branch index
  const branchErrors = new Map<number, InternalError[]>();
  for (const err of errors) {
    if (err === compositionError) continue;
    if (!err.schemaPath.startsWith(prefix + '/')) continue;
    if (!err.instancePath.startsWith(compositionError.instancePath)) continue;

    const rest = err.schemaPath.slice(prefix.length + 1); // e.g. '0/required'
    const branchIndex = parseInt(rest.split('/')[0], 10);
    if (isNaN(branchIndex)) continue;

    if (!branchErrors.has(branchIndex)) {
      branchErrors.set(branchIndex, []);
    }
    branchErrors.get(branchIndex)!.push(err);
  }

  if (branchErrors.size === 0) {
    return filterNonSubErrors(errors, compositionError);
  }

  // Get actual branch count from schema (not just branches with errors)
  const totalBranches = getSchemaCompositionBranchCount(schema, compositionError.schemaPath, keyword)
    ?? branchErrors.size;

  // Try discriminator resolution
  const discriminatorMsg = tryDiscriminatorResolution(
    keyword, schema, compositionError, branchErrors, payload,
  );

  if (discriminatorMsg) {
    compositionError.message = discriminatorMsg;
  } else {
    // Best-match: pick branch with fewest errors (first wins on tie)
    let bestBranch = -1;
    let bestCount = Infinity;
    const sortedBranches = [...branchErrors.keys()].sort((a, b) => a - b);
    for (const branch of sortedBranches) {
      const count = branchErrors.get(branch)!.length;
      if (count < bestCount) {
        bestCount = count;
        bestBranch = branch;
      }
    }

    const subMessages = branchErrors.get(bestBranch)!.map((e) => e.message);
    compositionError.message =
      `${keyword} best match (branch ${bestBranch + 1} of ${totalBranches}) failed: ${subMessages.join(', ')}`;
  }

  return filterNonSubErrors(errors, compositionError);
}

function findCompositionError(errors: InternalError[]): InternalError | undefined {
  // Search from the end for the last oneOf/anyOf error
  for (let i = errors.length - 1; i >= 0; i--) {
    if (errors[i].keyword === 'oneOf' || errors[i].keyword === 'anyOf') {
      return errors[i];
    }
  }
  return undefined;
}

function tryDiscriminatorResolution(
  keyword: string,
  schema: Record<string, unknown>,
  compositionError: InternalError,
  branchErrors: Map<number, InternalError[]>,
  payload: unknown,
): string | null {
  // Navigate schema to the parent object containing the composition keyword
  const schemaPath = compositionError.schemaPath; // e.g. '#/oneOf' or '#/allOf/1/oneOf'
  const segments = schemaPath.replace(/^#\//, '').split('/');
  // Remove the last segment (the keyword itself) to get the parent
  const parentSegments = segments.slice(0, -1);

  let parent: Record<string, unknown> = schema;
  for (const seg of parentSegments) {
    if (parent === null || parent === undefined || typeof parent !== 'object') return null;
    if (Array.isArray(parent)) {
      parent = parent[parseInt(seg, 10)] as Record<string, unknown>;
    } else {
      parent = parent[seg] as Record<string, unknown>;
    }
  }

  if (!parent || typeof parent !== 'object') return null;

  const discriminator = parent.discriminator as Record<string, unknown> | undefined;
  if (!discriminator?.propertyName) return null;

  const propName = discriminator.propertyName as string;

  // Get payload at the composition error's instancePath
  const instancePayload = getValueAtPath(payload, compositionError.instancePath);
  if (!instancePayload || typeof instancePayload !== 'object') return null;

  const discriminatorValue = (instancePayload as Record<string, unknown>)[propName];
  if (discriminatorValue === undefined || discriminatorValue === null) return null;

  // Find which branch matches the discriminator value
  const branches = parent[keyword] as Record<string, unknown>[];
  if (!Array.isArray(branches)) return null;

  let matchedBranch = -1;
  for (let i = 0; i < branches.length; i++) {
    if (branchHasDiscriminatorValue(branches[i], propName, discriminatorValue)) {
      matchedBranch = i;
      break;
    }
  }

  if (matchedBranch === -1) return null;

  const subErrors = branchErrors.get(matchedBranch);
  if (!subErrors || subErrors.length === 0) return null;

  const subMessages = subErrors.map((e) => e.message);
  return `${keyword} matched branch "${discriminatorValue}" (via discriminator "${propName}"), but: ${subMessages.join(', ')}`;
}

function branchHasDiscriminatorValue(
  branch: Record<string, unknown>,
  propName: string,
  value: unknown,
): boolean {
  // Check direct properties
  const props = branch.properties as Record<string, Record<string, unknown>> | undefined;
  if (props?.[propName]) {
    const prop = props[propName];
    if (Array.isArray(prop.enum) && prop.enum.includes(value)) return true;
    if (prop.const === value) return true;
  }

  // Recurse into allOf
  if (Array.isArray(branch.allOf)) {
    for (const sub of branch.allOf as Record<string, unknown>[]) {
      if (branchHasDiscriminatorValue(sub, propName, value)) return true;
    }
  }

  return false;
}

function getSchemaCompositionBranchCount(
  schema: Record<string, unknown>,
  schemaPath: string,
  keyword: string,
): number | null {
  const segments = schemaPath.replace(/^#\//, '').split('/');
  // Navigate to the parent, then read the keyword array length
  let current: unknown = schema;
  for (const seg of segments.slice(0, -1)) {
    if (current === null || current === undefined || typeof current !== 'object') return null;
    current = Array.isArray(current)
      ? (current as unknown[])[parseInt(seg, 10)]
      : (current as Record<string, unknown>)[seg];
  }
  if (!current || typeof current !== 'object') return null;
  const branches = (current as Record<string, unknown>)[keyword];
  return Array.isArray(branches) ? branches.length : null;
}

function filterNonSubErrors(
  errors: InternalError[],
  compositionError: InternalError,
): ValidationError[] {
  const prefix = compositionError.schemaPath + '/';
  return errors.filter((e) => {
    if (e === compositionError) return true;
    return !e.schemaPath.startsWith(prefix);
  });
}
