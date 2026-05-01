import type { ReportCategory } from "./types";

/**
 * Human-readable label for a category. Accepts unknown/undefined for
 * defensive rendering of records written by older Worker versions that
 * predate the category field.
 */
export function categoryLabel(c: ReportCategory | undefined): string {
  switch (c) {
    case "extension":
      return "Extension";
    case "browser-internal":
      return "Browser-internal";
    case "inline":
      return "Inline";
    case "data":
      return "data: URI";
    case "blob":
      return "blob: URL";
    case "eval":
      return "eval";
    case "same-origin":
      return "Same-origin";
    case "external":
      return "External";
    case "unknown":
    default:
      return "Unknown";
  }
}

/**
 * Tailwind classes that color-code the category badge. The choice tries to
 * track signal value: muted-noise categories use neutral tones, high-signal
 * ones lean toward warning/destructive.
 */
export function categoryBadgeClass(c: ReportCategory | undefined): string {
  switch (c) {
    case "extension":
    case "browser-internal":
      return "bg-muted text-muted-foreground border-transparent";
    case "inline":
    case "eval":
      return "bg-destructive text-white border-transparent";
    case "data":
    case "blob":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "same-origin":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
    case "external":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "unknown":
    default:
      return "bg-secondary text-secondary-foreground border-transparent";
  }
}
