// server/src/utils/operators.ts — detects NoSQL-operator / prototype-pollution keys in untrusted
// request data (NFR-003, SEC-9). Why: zod strict objects already reject unknown fields, but this
// runs *before* validation on the raw body/query so a payload such as `{"email":{"$ne":null}}` is
// rejected with a precise path instead of depending on every schema's input shape.
// Invariants: pure recursive walk over `unknown`; no `any`; never mutates the input; arrays are
// walked with numeric indices so `details[].path` points at the exact offending key.
//
// SEC-9 in REQUIREMENTS §9 says "strip $/. operators". We *reject* instead of silently stripping:
// a client that sends an operator gets a 400 VALIDATION_ERROR (observable and testable), whereas a
// silent strip would let an injection attempt look like a successful request.

const OPERATOR_PREFIX = '$';
const OPERATOR_SEPARATOR = '.';
/** Keys used by prototype-pollution attacks through JSON.parse (__proto__ becomes an own key). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isForbiddenKey(key: string): boolean {
  return (
    key.startsWith(OPERATOR_PREFIX) || key.includes(OPERATOR_SEPARATOR) || FORBIDDEN_KEYS.has(key)
  );
}

/**
 * Return the dotted paths of every forbidden key inside `value`.
 * Example: `findForbiddenKeys({ email: { $ne: null } })` → `['email.$ne']`.
 */
export function findForbiddenKeys(value: unknown, basePath = ''): string[] {
  const found: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, path.length > 0 ? `${path}.${index}` : `${index}`));
      return;
    }
    if (node === null || typeof node !== 'object') return;

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path.length > 0 ? `${path}.${key}` : key;
      if (isForbiddenKey(key)) {
        found.push(childPath);
      } else {
        walk(child, childPath);
      }
    }
  };

  walk(value, basePath);
  return found;
}
