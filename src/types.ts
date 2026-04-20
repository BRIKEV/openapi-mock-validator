export interface ValidatorOptions {
  strict?: boolean;
  /**
   * Content-Type of the response or request being validated.
   * Default: `"application/json"`.
   * Accepts exact types (`"image/jpeg"`) or is matched against wildcard
   * content-type entries in the spec (`"image/*"`, `"*\/*"`).
   */
  contentType?: string;
}

export interface PathMatch {
  path: string;
  params: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  expected?: string;
  received?: string;
}

export type WarningType = 'UNMATCHED_STATUS' | 'MISSING_SCHEMA' | 'EMPTY_SPEC_RESPONSE';

export interface ValidationWarning {
  message: string;
  type: WarningType;
}

export interface CompiledPath {
  specPath: string;
  matcher: (url: string) => PathMatchResult | false;
  paramCount: number;
  methods: string[];
}

interface PathMatchResult {
  path: string;
  params: Record<string, unknown>;
}

export interface OpenAPISpec {
  openapi: string;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  trace?: OperationObject;
  [key: string]: unknown;
}

export interface OperationObject {
  responses?: Record<string, ResponseObject>;
  requestBody?: RequestBodyObject;
  [key: string]: unknown;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaTypeObject>;
  [key: string]: unknown;
}

export interface RequestBodyObject {
  content?: Record<string, MediaTypeObject>;
  required?: boolean;
  [key: string]: unknown;
}

export interface MediaTypeObject {
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}
