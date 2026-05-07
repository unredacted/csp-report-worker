import type { IssueStatus } from "./types";

export function statusLabel(s: IssueStatus): string {
  switch (s) {
    case "open":
      return "Open";
    case "acknowledged":
      return "Acknowledged";
    case "ignored":
      return "Ignored";
    case "resolved":
      return "Resolved";
  }
}

export function statusBadgeClass(s: IssueStatus): string {
  switch (s) {
    case "open":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "acknowledged":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "ignored":
      return "bg-muted text-muted-foreground border-transparent";
    case "resolved":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  }
}
