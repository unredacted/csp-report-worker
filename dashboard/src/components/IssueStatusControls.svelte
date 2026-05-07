<script lang="ts">
  import { createMutation, useQueryClient } from "@tanstack/svelte-query";
  import { toast } from "svelte-sonner";
  import Check from "lucide-svelte/icons/check";
  import CircleSlash from "lucide-svelte/icons/circle-slash";
  import EyeOff from "lucide-svelte/icons/eye-off";
  import RotateCcw from "lucide-svelte/icons/rotate-ccw";
  import Button from "@/components/ui/Button.svelte";
  import { patchIssue } from "@/lib/api";
  import type { Issue, IssueStatus } from "@/lib/types";

  let { issue }: { issue: Issue } = $props();

  const queryClient = useQueryClient();

  const mutation = createMutation(() => ({
    mutationFn: (vars: { status: IssueStatus; reason?: string }) =>
      patchIssue(issue.id, vars.status, vars.reason),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["issue", issue.id] });
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      toast.success(`Marked ${vars.status}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    },
  }));

  function update(status: IssueStatus) {
    mutation.mutate({ status });
  }

  let busy = $derived(mutation.isPending);
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if issue.status !== "acknowledged"}
    <Button
      variant="outline"
      size="sm"
      onclick={() => update("acknowledged")}
      disabled={busy}
    >
      <EyeOff class="size-4" />
      <span>Acknowledge</span>
    </Button>
  {/if}

  {#if issue.status !== "resolved"}
    <Button
      variant="outline"
      size="sm"
      onclick={() => update("resolved")}
      disabled={busy}
    >
      <Check class="size-4" />
      <span>Resolve</span>
    </Button>
  {/if}

  {#if issue.status !== "ignored"}
    <Button
      variant="outline"
      size="sm"
      onclick={() => update("ignored")}
      disabled={busy}
    >
      <CircleSlash class="size-4" />
      <span>Ignore</span>
    </Button>
  {/if}

  {#if issue.status === "resolved" || issue.status === "ignored"}
    <Button variant="outline" size="sm" onclick={() => update("open")} disabled={busy}>
      <RotateCcw class="size-4" />
      <span>Reopen</span>
    </Button>
  {/if}
</div>
