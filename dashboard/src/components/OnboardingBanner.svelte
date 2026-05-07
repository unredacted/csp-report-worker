<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import X from "lucide-svelte/icons/x";
  import Link from "@/components/Link.svelte";
  import { listProperties } from "@/lib/api";

  const DISMISSED_KEY = "csp-report-worker:default-banner-dismissed";

  let dismissed = $state(
    typeof window !== "undefined" ? localStorage.getItem(DISMISSED_KEY) === "1" : false,
  );

  const query = createQuery(() => ({
    queryKey: ["properties"],
    queryFn: () => listProperties(),
    staleTime: 60_000,
  }));

  let show = $derived.by(() => {
    if (dismissed) return false;
    const props = query.data?.properties ?? [];
    const hasDefault = props.some((p) => p.id === "default");
    const hasOther = props.some((p) => p.id !== "default" && !p.archivedAt);
    return hasDefault && hasOther;
  });

  function dismiss() {
    dismissed = true;
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // No-op if localStorage unavailable.
    }
  }
</script>

{#if show}
  <div class="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm flex items-start gap-3">
    <div class="flex-1">
      Reports may still be landing under <code class="font-mono">default</code>.
      <Link to="/properties" class="underline hover:text-foreground">Configure properties</Link>
      and route your site's <code class="font-mono">report-uri</code> to
      <code class="font-mono">/r/&lt;slug&gt;?t=&lt;token&gt;</code> for proper scoping.
    </div>
    <button
      type="button"
      onclick={dismiss}
      class="text-muted-foreground hover:text-foreground"
      aria-label="Dismiss"
    >
      <X class="size-4" />
    </button>
  </div>
{/if}
