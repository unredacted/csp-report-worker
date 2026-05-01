import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listReports } from "@/lib/api";
import type { ReportCategory } from "@/lib/types";
import { categoryBadgeClass, categoryLabel } from "@/lib/category";

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
    categories: [
      "inline",
      "data",
      "blob",
      "eval",
      "same-origin",
      "external",
      "unknown",
    ],
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

type SortDir = "desc" | "asc";

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") as View) || "all";
  const pageSizeParam = parseInt(searchParams.get("size") || "", 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;

  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Cursor history. Index 0 is always undefined (page 1 has no cursor);
  // index N is the cursor needed to fetch the page (N+1)-th batch.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex];

  const tab = TABS.find((t) => t.key === view) ?? TABS[0]!;

  // Reset pagination when filters that change the result set change.
  useEffect(() => {
    setCursors([undefined]);
    setPageIndex(0);
  }, [view, pageSize]);

  const query = useQuery({
    queryKey: ["reports", view, pageSize, cursor],
    queryFn: () =>
      listReports({
        limit: pageSize,
        cursor,
        categories: tab.categories.length > 0 ? tab.categories : undefined,
      }),
    staleTime: 30_000,
  });

  const pageReports = query.data?.reports ?? [];
  const hasNextPage = Boolean(query.data?.cursor);

  const filtered = useMemo(() => {
    if (!search.trim()) return pageReports;
    const q = search.toLowerCase();
    return pageReports.filter(
      (r) =>
        r.documentUri.toLowerCase().includes(q) ||
        r.blockedUri.toLowerCase().includes(q) ||
        r.violatedDirective.toLowerCase().includes(q),
    );
  }, [pageReports, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aT = new Date(a.timestamp).getTime();
      const bT = new Date(b.timestamp).getTime();
      return sortDir === "desc" ? bT - aT : aT - bT;
    });
  }, [filtered, sortDir]);

  function setView(next: View) {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  }

  function setPageSize(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next === DEFAULT_PAGE_SIZE) params.delete("size");
    else params.set("size", String(next));
    setSearchParams(params, { replace: true });
  }

  function nextPage() {
    if (!hasNextPage) return;
    const next = query.data!.cursor!;
    setCursors((prev) => {
      const out = prev.slice(0, pageIndex + 2);
      out[pageIndex + 1] = next;
      return out;
    });
    setPageIndex(pageIndex + 1);
  }

  function prevPage() {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
  }

  function toggleSort() {
    setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">{tab.description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          <span>Refresh</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          className="max-w-xs"
          placeholder="Filter by URL or directive…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span>Per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(parseInt(v, 10))}
          >
            <SelectTrigger className="w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {query.error instanceof Error ? query.error.message : "Failed to load reports"}
        </div>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">
                <button
                  type="button"
                  onClick={toggleSort}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Time
                  {sortDir === "desc" ? (
                    <ArrowDown className="size-3" />
                  ) : sortDir === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowUpDown className="size-3" />
                  )}
                </button>
              </TableHead>
              <TableHead className="w-[140px]">Category</TableHead>
              <TableHead className="w-[160px]">Directive</TableHead>
              <TableHead>Document</TableHead>
              <TableHead>Blocked</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                  <Loader2 className="inline size-4 animate-spin mr-2" />
                  Loading reports…
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                  No reports match this view.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow key={r.id} className="cursor-pointer">
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.timestamp), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`${categoryBadgeClass(r.category)} whitespace-nowrap`}
                    >
                      {categoryLabel(r.category)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.violatedDirective || "(unknown)"}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate font-mono text-xs">
                    {r.documentUri}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate font-mono text-xs text-destructive">
                    {r.blockedUri || "(inline)"}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/detail/${r.id}`}
                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                      aria-label={`View report ${r.id}`}
                    >
                      <ChevronRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Page {pageIndex + 1}
          {sorted.length > 0 ? (
            <>
              {" — "}
              <span>
                showing {sorted.length}
                {search.trim() && pageReports.length !== sorted.length
                  ? ` of ${pageReports.length} on this page`
                  : ""}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={prevPage}
            disabled={pageIndex === 0 || query.isFetching}
          >
            <ChevronLeft className="size-4" />
            <span>Previous</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={nextPage}
            disabled={!hasNextPage || query.isFetching}
          >
            <span>Next</span>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
