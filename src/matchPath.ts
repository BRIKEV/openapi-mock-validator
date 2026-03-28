import { match } from 'path-to-regexp';
import type { CompiledPath, PathMatch } from './types.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

export function compilePaths(
  specPaths: Record<string, Record<string, unknown>>,
): CompiledPath[] {
  const compiled: CompiledPath[] = [];

  for (const [specPath, pathItem] of Object.entries(specPaths)) {
    const methods = Object.keys(pathItem).filter((m) => HTTP_METHODS.includes(m));
    // Convert OpenAPI {param} to path-to-regexp :param
    const regexpPath = specPath.replace(/\{([^}]+)\}/g, ':$1');
    const paramCount = (specPath.match(/\{[^}]+\}/g) || []).length;
    const matcher = match(regexpPath, { decode: decodeURIComponent });

    compiled.push({
      specPath,
      matcher,
      paramCount,
      methods,
    });
  }

  // Sort by specificity: fewer params first (literal paths win)
  compiled.sort((a, b) => a.paramCount - b.paramCount);

  return compiled;
}

export function matchUrl(
  compiled: CompiledPath[],
  url: string,
  method: string,
): PathMatch | null {
  const normalizedMethod = method.toLowerCase();

  // Strip query string
  let normalizedUrl = url.split('?')[0];
  // Strip trailing slash (but keep root "/")
  if (normalizedUrl.length > 1 && normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  for (const entry of compiled) {
    const result = entry.matcher(normalizedUrl);
    if (result && entry.methods.includes(normalizedMethod)) {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.params)) {
        params[key] = String(value);
      }
      return {
        path: entry.specPath,
        params,
      };
    }
  }

  return null;
}
