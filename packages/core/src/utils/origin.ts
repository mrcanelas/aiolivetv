/**
 * Compare origins so default HTTP/HTTPS ports still match.
 * `http://localhost:80/foo` serialises to `http://localhost/foo`, which
 * would fail a string prefix check against `http://localhost:80`.
 */
export function sameOrigin(left: string | URL, right: string | URL): boolean {
  try {
    const a = left instanceof URL ? left : new URL(left);
    const b = right instanceof URL ? right : new URL(right);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}
