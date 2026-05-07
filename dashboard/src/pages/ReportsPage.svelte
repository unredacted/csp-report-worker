<script lang="ts" module>
  type View = "all" | "genuine" | "extension" | "high";

  interface TabSpec {
    key: View;
    label: string;
    description: string;
    /** Categories to request from the server. Empty = no filter. */
    categories: readonly ReportCategory[];
  }

  const TABS: readonly TabSpec[] = [
    {
      key: "all",
      label: "All",
      description: "Every stored report.",
      categories: [],
    },
    {
      key: "genuine",
      label: "Genuine",
      description: "Excludes browser-extension and browser-internal noise.",
      categories: ["inline", "data", "blob", "eval", "same-origin", "external", "unknown"],
    },
    {
      key: "extension",
      label: "Extension noise",
      description: "Reports caused by user-installed browser extensions.",
      categories: ["extension", "browser-internal"],
    },
    {
      key: "high",
      label: "High signal",
      description: "Inline scripts/styles and eval — high-signal XSS indicators.",
      categories: ["inline", "eval"],
    },
  ];

  const PAGE_SIZES = [25, 50, 100, 200] as const;
  const DEFAULT_PAGE_SIZE = 50;
  const PAGE_SIZE_ITEMS = PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }));

  type SortDir = "desc" | "asc";
</script>

<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { formatDistanceToNow } from "date-fns";
  import ArrowDown from "lucide-svelte/icons/arrow-down";
  import ArrowUp from "lucide-svelte/icons/arrow-up";
  import ChevronLeft from "lucide-svelte/icons/chevron-left";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import Loader2 from "lucide-svelte/icons/loader-2";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Select from "@/components/ui/Select.svelte";
  import Tabs from "@/components/ui/Tabs.svelte";
  import TabsList from "@/components/ui/TabsList.svelte";
  import TabsTrigger from "@/components/ui/TabsTrigger.svelte";
  import Table from "@/components/ui/Table.svelte";
  import TableBody from "@/components/ui/TableBody.svelte";
  import TableCell from "@/components/ui/TableCell.svelte";
  import TableHead from "@/components/ui/TableHead.svelte";
  import TableHeader from "@/components/ui/TableHeader.svelte";
  import TableRow from "@/components/ui/TableRow.svelte";
  import Link from "@/components/Link.svelte";
  import { listReports } from "@/lib/api";
  import { router } from "@/lib/router.svelte";
  import type { ReportCategory } from "@/lib/types";
  import { categoryBadgeClass, categoryLabel } from "@/lib/category";

  // URL-backed state (single source of truth: the query string)
  let view = $derived<View>(((router.searchParams.get("view") as View) || "all"));
  let pageSize = $derived(
    (() => {
      const v = parseInt(router.searchParams.get("size") || "", 10);
      return (PAGE_SIZES as readonly number[]).includes(v) ? v : DEFAULT_PAGE_SIZE;
    })(),
  );
  let tab = $derived(TABS.find((t) => t.key === view) ?? TABS[0]!);

  // Local state
  let search = $state("");
  let sortDir = $state<SortDir>("desc");
  let cursors = $state<(string | undefined)[]>([undefined]);
  let pageIndex = $state(0);
  let cursor = $derived(cursors[pageIndex]);

  // Reset pagination when view or pageSize changes.
  // Track the watched values so the effect runs on change without an explicit dep array.
  $effect(() => {
    void view;
    void pageSize;
    cursors = [undefined];
    pageIndex = 0;
  });

  const query = createQuery(() => ({
    queryKey: ["reports", view, pageSize, cursor],
    queryFn: () =>
      listReports({
        limit: pageSize,
        cursor,
        categories: tab.categories.length > 0 ? tab.categories : undefined,
      }),
    staleTime: 30_000,
  }));

  let pageReports = $derived(query.data?.reports ?? []);
  let hasNextPage = $derived(Boolean(query.data?.cursor));

  let filtered = $derived.by(() => {
    if (!search.trim()) return pageReports;
    const q = search.toLowerCase();
    return pageReports.filter(
      (r) =>
        r.documentUri.toLowerCase().includes(q) ||
        r.blockedUri.toLowerCase().includes(q) ||
        r.violatedDirective.toLowerCase().includes(q),
    );
  });

  let sorted = $derived.by(() =>
    [...filtered].sort((a, b) => {
      const aT = new Date(a.timestamp).getTime();
      const bT = new Date(b.timestamp).getTime();
      return sortDir === "desc" ? bT - aT : aT - bT;
    }),
  );

  function setView(next: View) {
    const params = router.searchParams;
    if (next === "all") params.delete("view");
    else params.set("view", next);
    router.setSearchParams(params, { replace: true });
  }

  function setPageSize(next: number) {
    const params = router.searchParams;
    if (next === DEFAULT_PAGE_SIZE) params.delete("size");
    else params.set("size", String(next));
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

  function toggleSort() {
    sortDir = sortDir === "desc" ? "asc" : "desc";
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Reports</h1>
      <p class="text-sm text-muted-foreground">{tab.description}</p>
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

  <div class="flex flex-wrap items-center gap-3">
    <Tabs value={view} onValueChange={(v) => setView(v as View)}>
      <TabsList>
        {#each TABS as t (t.key)}
          <TabsTrigger value={t.key}>{t.label}</TabsTrigger>
        {/each}
      </TabsList>
    </Tabs>
    <Input
      class="max-w-xs"
      placeholder="Filter by URL or directive…"
      bind:value={search}
    />
    <div class="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
      <span>Per page</span>
      <Select
        class="w-[88px]"
        value={String(pageSize)}
        items={PAGE_SIZE_ITEMS}
        onValueChange={(v) => setPageSize(parseInt(v, 10))}
      />
    </div>
  </div>

  {#if query.isError}
    <div class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      {query.error instanceof Error ? query.error.message : "Failed to load reports"}
    </div>
  {/if}

  <div class="rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[160px]">
            <button
              type="button"
              onclick={toggleSort}
              class="inline-flex items-center gap-1 hover:text-foreground"
            >
              Time
              {#if sortDir === "desc"}
                <ArrowDown class="size-3" />
              {:else}
                <ArrowUp class="size-3" />
              {/if}
            </button>
          </TableHead>
          <TableHead class="w-[140px]">Category</TableHead>
          <TableHead class="w-[160px]">Directive</TableHead>
          <TableHead>Document</TableHead>
          <TableHead>Blocked</TableHead>
          <TableHead class="w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {#if query.isLoading}
          <TableRow>
            <TableCell class="text-center text-muted-foreground py-12">
              <Loader2 class="inline size-4 animate-spin mr-2" />
              Loading reports…
            </TableCell>
          </TableRow>
        {:else if sorted.length === 0}
          <TableRow>
            <TableCell class="text-center text-muted-foreground py-12">
              No reports match this view.
            </TableCell>
          </TableRow>
        {:else}
          {#each sorted as r (r.id)}
            <TableRow class="cursor-pointer">
              <TableCell class="text-muted-foreground text-xs whitespace-nowrap">
                {formatDistanceToNow(new Date(r.timestamp), { addSuffix: true })}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  class={`${categoryBadgeClass(r.category)} whitespace-nowrap`}
                >
                  {categoryLabel(r.category)}
                </Badge>
              </TableCell>
              <TableCell class="font-mono text-xs">
                {r.violatedDirective || "(unknown)"}
              </TableCell>
              <TableCell class="max-w-[280px] truncate font-mono text-xs">
                {r.documentUri}
              </TableCell>
              <TableCell class="max-w-[280px] truncate font-mono text-xs text-destructive">
                {r.blockedUri || "(inline)"}
              </TableCell>
              <TableCell>
                <Link
                  to={`/detail/${r.id}`}
                  class="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label={`View report ${r.id}`}
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
    <div>
      Page {pageIndex + 1}
      {#if sorted.length > 0}
        — <span>
          showing {sorted.length}{search.trim() && pageReports.length !== sorted.length
            ? ` of ${pageReports.length} on this page`
            : ""}
        </span>
      {/if}
    </div>
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
