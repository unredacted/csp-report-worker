<script lang="ts">
  import Badge from "@/components/ui/Badge.svelte";
  import { statusBadgeClass, statusLabel } from "@/lib/issue-status";
  import type { IssueStatus } from "@/lib/types";

  let { status, class: className = "" }: { status: IssueStatus; class?: string } = $props();
</script>

<Badge variant="outline" class={`${statusBadgeClass(status)} ${className}`}>
  {statusLabel(status)}
</Badge>
