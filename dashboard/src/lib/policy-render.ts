/**
 * Client-side mirror of src/policy.ts `renderPolicy` for the live preview.
 * Same algorithm — keep in sync if either side changes.
 */

import type { PolicySelection } from "./types";

export function renderPolicyClient(
  baseline: string,
  selections: readonly PolicySelection[],
): string {
  const order: string[] = [];
  const directives = new Map<string, string[]>();

  for (const part of baseline.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[0];
    if (!name) continue;
    if (!directives.has(name)) {
      order.push(name);
      directives.set(name, tokens.slice(1));
    } else {
      directives.get(name)!.push(...tokens.slice(1));
    }
  }

  for (const sel of selections) {
    if (!directives.has(sel.directive)) {
      order.push(sel.directive);
      directives.set(sel.directive, []);
    }
    const sources = directives.get(sel.directive)!;
    if (!sources.includes(sel.value)) sources.push(sel.value);
  }

  return order
    .map((name) => {
      const sources = directives.get(name) ?? [];
      return sources.length > 0 ? `${name} ${sources.join(" ")}` : name;
    })
    .join("; ");
}
