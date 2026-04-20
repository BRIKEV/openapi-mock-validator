import type { OpenAPISpec, ValidationWarning } from './types.js';

const BINARY_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const BINARY_EXACT = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/zip',
]);

export function isBinaryContentType(contentType: string): boolean {
  return BINARY_PREFIXES.some((prefix) => contentType.startsWith(prefix))
    || BINARY_EXACT.has(contentType);
}

export function resolveMediaType(
  content: Record<string, Record<string, unknown>>,
  contentType: string,
): Record<string, unknown> | null {
  if (content[contentType]) return content[contentType];

  const slashIndex = contentType.indexOf('/');
  if (slashIndex > 0) {
    const family = `${contentType.slice(0, slashIndex)}/*`;
    if (content[family]) return content[family];
  }

  if (content['*/*']) return content['*/*'];

  return null;
}

interface SchemaExtractionResult {
  schema: Record<string, unknown> | null;
  warnings: ValidationWarning[];
}

export function extractResponseSchema(
  spec: OpenAPISpec,
  path: string,
  method: string,
  status: number,
  contentType: string = 'application/json',
): SchemaExtractionResult {
  const warnings: ValidationWarning[] = [];
  const normalizedMethod = method.toLowerCase();
  const statusStr = String(status);

  const pathItem = spec.paths[path];
  if (!pathItem) {
    return { schema: null, warnings: [{ type: 'UNMATCHED_STATUS', message: `Path ${path} not found in spec` }] };
  }

  const operation = pathItem[normalizedMethod as keyof typeof pathItem];
  if (!operation || typeof operation !== 'object' || !('responses' in operation)) {
    return { schema: null, warnings: [{ type: 'UNMATCHED_STATUS', message: `Method ${method.toUpperCase()} not found for ${path}` }] };
  }

  const responses = (operation as { responses?: Record<string, unknown> }).responses;
  if (!responses) {
    return { schema: null, warnings: [{ type: 'UNMATCHED_STATUS', message: `No responses defined for ${method.toUpperCase()} ${path}` }] };
  }

  const response = responses[statusStr] as Record<string, unknown> | undefined;
  if (!response) {
    warnings.push({
      type: 'UNMATCHED_STATUS',
      message: `Status ${status} not documented for ${method.toUpperCase()} ${path}`,
    });
    return { schema: null, warnings };
  }

  const content = response.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) {
    warnings.push({
      type: 'EMPTY_SPEC_RESPONSE',
      message: `Response ${status} has no content definition for ${method.toUpperCase()} ${path}`,
    });
    return { schema: null, warnings };
  }

  const mediaType = resolveMediaType(content, contentType);
  if (!mediaType) {
    if (isBinaryContentType(contentType)) {
      return { schema: null, warnings: [] };
    }
    warnings.push({
      type: 'MISSING_SCHEMA',
      message: `No ${contentType} content for ${method.toUpperCase()} ${path} (${status})`,
    });
    return { schema: null, warnings };
  }

  const schema = mediaType.schema as Record<string, unknown> | undefined;
  if (!schema) {
    warnings.push({
      type: 'MISSING_SCHEMA',
      message: `No response schema defined for ${method.toUpperCase()} ${path} (${status})`,
    });
    return { schema: null, warnings };
  }

  return { schema, warnings };
}

export function extractRequestSchema(
  spec: OpenAPISpec,
  path: string,
  method: string,
  contentType: string = 'application/json',
): SchemaExtractionResult {
  const warnings: ValidationWarning[] = [];
  const normalizedMethod = method.toLowerCase();

  const pathItem = spec.paths[path];
  if (!pathItem) {
    return { schema: null, warnings: [{ type: 'MISSING_SCHEMA', message: `Path ${path} not found in spec` }] };
  }

  const operation = pathItem[normalizedMethod as keyof typeof pathItem];
  if (!operation || typeof operation !== 'object') {
    return { schema: null, warnings: [{ type: 'MISSING_SCHEMA', message: `Method ${method.toUpperCase()} not found for ${path}` }] };
  }

  const requestBody = (operation as { requestBody?: Record<string, unknown> }).requestBody;
  if (!requestBody) {
    warnings.push({
      type: 'MISSING_SCHEMA',
      message: `No requestBody defined for ${method.toUpperCase()} ${path}`,
    });
    return { schema: null, warnings };
  }

  const content = requestBody.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) {
    warnings.push({
      type: 'MISSING_SCHEMA',
      message: `No content defined in requestBody for ${method.toUpperCase()} ${path}`,
    });
    return { schema: null, warnings };
  }

  const mediaType = resolveMediaType(content, contentType);
  if (!mediaType) {
    if (isBinaryContentType(contentType)) {
      return { schema: null, warnings: [] };
    }
    warnings.push({
      type: 'MISSING_SCHEMA',
      message: `No ${contentType} content in requestBody for ${method.toUpperCase()} ${path}`,
    });
    return { schema: null, warnings };
  }

  const schema = mediaType.schema as Record<string, unknown> | undefined;
  if (!schema) {
    warnings.push({
      type: 'MISSING_SCHEMA',
      message: `No schema defined in requestBody for ${method.toUpperCase()} ${path}`,
    });
    return { schema: null, warnings };
  }

  return { schema, warnings };
}
