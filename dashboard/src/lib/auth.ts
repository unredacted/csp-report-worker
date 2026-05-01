/**
 * SessionStorage-backed token store. Cleared when the browser closes;
 * not persisted to disk. Suitable for an internal SecOps tool — not
 * a hardened SSO flow.
 */

const KEY = "csp-report-worker:token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // sessionStorage might be unavailable (private mode, embedded contexts).
    // Failing closed is fine — the user will simply have to re-enter on
    // their next request.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // No-op
  }
}
