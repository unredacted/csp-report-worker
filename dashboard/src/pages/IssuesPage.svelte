<script lang="ts" module>
  import type { IssueStatus } from "@/lib/types";

  type StatusFilter = "active" | "all" | IssueStatus;

  interface FilterSpec {
    key: StatusFilter;
    label: string;
    description: string;
    statuses: readonly IssueStatus[];
  }

  const FILTERS: readonly FilterSpec[] = [
    {
      key: "active",
      label: "Active",
      description: "Open or acknowledged — needs your attention.",
      statuses: ["open", "acknowledged"],
    },
    {
      key: "open",
      label: "Open",
      description: "New issues with no triage decision yet.",
      statuses: ["open"],
    },
    {
      key: "acknowledged",
      label: "Acknowledged",
      description: "Seen but not yet resolved.",
      statuses: ["acknowledged"],
    },
    {
      key: "resolved",
      label: "Resolved",
      description: "Fixed — will resurrect on a new report after the grace window.",
      statuses: ["resolved"],
    },
    {
      key: "ignored",
      label: "Ignored",
      description: "Permanently silenced — counts still increment.",
      statuses: ["ignored"],
    },
    {
      key: "all",
      label: "All",
      description: "Every issue in this property.",
      statuses: [],
    },
  ];
</script>

<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { formatDistanceToNow } from "date-fns";
  import ChevronLeft from "lucide-svelte/icons/chevron-left";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import Loader2 from "lucide-svelte/icons/loader-2";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Tabs from "@/components/ui/Tabs.svelte";
  import TabsList from "@/components/ui/TabsList.svelte";
  import TabsTrigger from "@/components/ui/TabsTrigger.svelte";
  import Table from "@/components/ui/Table.svelte";
  import TableBody from "@/components/ui/TableBody.svelte";
  import TableCell from "@/components/ui/TableCell.svelte";
  import TableHead from "@/components/ui/TableHead.svelte";
  import TableHeader from "@/components/ui/TableHeader.svelte";
  import TableRow from "@/components/ui/TableRow.svelte";
  import IssueStatusBadge from "@/components/IssueStatusBadge.svelte";
  import Link from "@/components/Link.svelte";
  import { listIssues } from "@/lib/api";
  import { propertyStore } from "@/lib/property-store.svelte";
  import { router } from "@/lib/router.svelte";
  import { categoryBadgeClass, categoryLabel } from "@/lib/category";
  import OnboardingBanner from "@/components/OnboardingBanner.svelte";

  let filterKey = $derived<StatusFilter>(
    (router.searchParams.get("filter") as StatusFilter) || "active",
  );
  let filter = $derived(FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0]!);

  let cursors = $state<(string | undefined)[]>([undefined]);
  let pageIndex = $state(0);
  let cursor = $derived(cursors[pageIndex]);

  $effect(() => {
    void filterKey;
    void propertyStore.selectedId;
    cursors = [undefined];
    pageIndex = 0;
  });

  const query = createQuery(() => ({
    queryKey: ["issues", propertyStore.selectedId, filterKey, cursor],
    queryFn: () =>
      listIssues({
        property: propertyStore.selectedId,
        statuses: filter.statuses.length > 0 ? filter.statuses : undefined,
        cursor,
        limit: 50,
      }),
    staleTime: 30_000,
  }));

  let issues = $derived(query.data?.issues ?? []);
  let hasNextPage = $derived(Boolean(query.data?.cursor));

  function setFilter(next: StatusFilter) {
    const params = router.searchParams;
    if (next === "active") params.delete("filter");
    else params.set("filter", next);
    router.setSearchParams(params, { replace: true });
  }

  function nextPage() {
    if (!hasNextPage) return;
    const next = query.data!.cursor!;
    const updated = cursors.slice(0, pageIndex + 2);
    updated[pageIndex + 1] = next;
    cursors = updated;
    pageIndex = pageIndex + 1;
  }

  function prevPage() {
    if (pageIndex === 0) return;
    pageIndex = pageIndex - 1;
  }
</script>

<div class="space-y-4">
  <OnboardingBanner />

  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Issues</h1>
      <p class="text-sm text-muted-foreground">{filter.description}</p>
    </div>
    <Button
      variant="outline"
      size="sm"
      onclick={() => query.refetch()}
      disabled={query.isFetching}
    >
      {#if query.isFetching}
        <Loader2 class="size-4 animate-spin" />
      {:else}
        <RefreshCw class="size-4" />
      {/if}
      <span>Refresh</span>
    </Button>
  </div>

  <Tabs value={filterKey} onValueChange={(v) => setFilter(v as StatusFilter)}>
    <TabsList>
      {#each FILTERS as f (f.key)}
        <TabsTrigger value={f.key}>{f.label}</TabsTrigger>
      {/each}
    </TabsList>
  </Tabs>

  {#if query.isError}
    <div class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      {query.error instanceof Error ? query.error.message : "Failed to load issues"}
    </div>
  {/if}

  <div class="rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[120px]">Status</TableHead>
          <TableHead class="w-[80px] text-right">Events</TableHead>
          <TableHead class="w-[160px]">Last seen</TableHead>
          <TableHead class="w-[160px]">Directive</TableHead>
          <TableHead class="w-[140px]">Category</TableHead>
          <TableHead>Sample</TableHead>
          <TableHead class="w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {#if query.isLoading}
          <TableRow>
            <TableCell class="text-center text-muted-foreground py-12">
              <Loader2 class="inline size-4 animate-spin mr-2" />
              Loading issues…
            </TableCell>
          </TableRow>
        {:else if issues.length === 0}
          <TableRow>
            <TableCell class="text-center text-muted-foreground py-12">
              No issues match this filter.
            </TableCell>
          </TableRow>
        {:else}
          {#each issues as issue (issue.id)}
            <TableRow>
              <TableCell><IssueStatusBadge status={issue.status} /></TableCell>
              <TableCell class="text-right tabular-nums font-mono text-xs">
                {issue.eventCount}
              </TableCell>
              <TableCell class="text-muted-foreground text-xs whitespace-nowrap">
                {formatDistanceToNow(new Date(issue.lastSeen), { addSuffix: true })}
              </TableCell>
              <TableCell class="font-mono text-xs">
                {issue.violatedDirective || "(unknown)"}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  class={`${categoryBadgeClass(issue.category)} whitespace-nowrap`}
                >
                  {categoryLabel(issue.category)}
                </Badge>
              </TableCell>
              <TableCell class="max-w-[420px] truncate font-mono text-xs">
                {issue.sampleTitle}
              </TableCell>
              <TableCell>
                <Link
                  to={`/issues/${encodeURIComponent(issue.id)}`}
                  class="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label={`View issue ${issue.id}`}
                >
                  <ChevronRight class="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          {/each}
        {/if}
      </TableBody>
    </Table>
  </div>

  <div class="flex items-center justify-between text-sm text-muted-foreground">
    <div>Page {pageIndex + 1} — {issues.length} issue{issues.length === 1 ? "" : "s"}</div>
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={prevPage}
        disabled={pageIndex === 0 || query.isFetching}
      >
        <ChevronLeft class="size-4" />
        <span>Previous</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onclick={nextPage}
        disabled={!hasNextPage || query.isFetching}
      >
        <span>Next</span>
        <ChevronRight class="size-4" />
      </Button>
    </div>
  </div>
</div>
