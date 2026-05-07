<script lang="ts">
  import type { IssueAggregates } from "@/lib/types";

  let { aggregates }: { aggregates: IssueAggregates } = $props();

  const sections = $derived([
    { title: "Top countries", buckets: aggregates.countries, empty: "No country data" },
    { title: "Top ASNs", buckets: aggregates.asns, empty: "No ASN data" },
    { title: "Browsers", buckets: aggregates.browsers, empty: "No browser data" },
  ]);
</script>

<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
  {#each sections as section (section.title)}
    <div class="rounded-md border bg-card p-3">
      <div class="text-xs font-medium text-muted-foreground mb-2">{section.title}</div>
      {#if section.buckets.length === 0}
        <div class="text-xs text-muted-foreground">{section.empty}</div>
      {:else}
        <dl class="space-y-1">
          {#each section.buckets as b (b.label)}
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <dt class="truncate font-mono text-xs" title={b.label}>{b.label}</dt>
              <dd class="text-muted-foreground tabular-nums">{b.count}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    </div>
  {/each}
</div>
