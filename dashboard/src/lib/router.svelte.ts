/**
 * Tiny client-side router for the SPA.
 *
 * Browser-history routing (push/replaceState + popstate) — fits the
 * Worker's ASSETS fallback that serves index.html for any unmatched GET.
 * Reactive via Svelte 5 runes; consumers read `router.path` / `router.search`
 * and the templates re-render automatically.
 */

class Router {
  path = $state(typeof window !== "undefined" ? window.location.pathname : "/");
  search = $state(typeof window !== "undefined" ? window.location.search : "");

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", () => {
        this.path = window.location.pathname;
        this.search = window.location.search;
      });
    }
  }

  navigate(to: string, opts?: { replace?: boolean }) {
    const url = new URL(to, window.location.origin);
    const target = url.pathname + url.search;
    if (opts?.replace) window.history.replaceState({}, "", target);
    else window.history.pushState({}, "", target);
    this.path = url.pathname;
    this.search = url.search;
  }

  setSearchParams(params: URLSearchParams, opts?: { replace?: boolean }) {
    const next = params.toString();
    const search = next ? `?${next}` : "";
    const target = this.path + search;
    if (opts?.replace) window.history.replaceState({}, "", target);
    else window.history.pushState({}, "", target);
    this.search = search;
  }

  get searchParams(): URLSearchParams {
    return new URLSearchParams(this.search);
  }
}

export const router = new Router();

/**
 * Match a route pattern against a path and extract params.
 * Returns the params object on match, or null on miss.
 *
 *   match("/issues/:id", "/issues/abc")  → { id: "abc" }
 *   match("/issues",     "/reports")     → null
 *   match("*",           anything)       → {}
 */
export function match(pattern: string, p: string): Record<string, string> | null {
  if (pattern === "*") return {};
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = p.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const tp = pathParts[i]!;
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(tp);
    } else if (pp !== tp) {
      return null;
    }
  }
  return params;
}
