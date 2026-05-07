/**
 * Selected-property state, persisted in localStorage.
 *
 * Subscribed via Svelte 5 runes — components that read `propertyStore.selectedId`
 * re-render on change. Calling `propertyStore.select("...")` also writes to
 * localStorage so the choice survives reload.
 */

const KEY = "csp-report-worker:property";

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? "default";
  } catch {
    return "default";
  }
}

function save(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Ignore (private mode, quota, etc.)
  }
}

class PropertyStore {
  selectedId = $state<string>(typeof window !== "undefined" ? load() : "default");

  select(id: string): void {
    this.selectedId = id;
    save(id);
  }
}

export const propertyStore = new PropertyStore();
