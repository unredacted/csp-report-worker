import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type View = "all" | "genuine" | "extension" | "inline";

interface TabSpec {
  key: View;
  label: string;
  description: string;
  filter?: (cat: ReportCategory) => boolean;
}

const TABS: readonly TabSpec[] = [
  { key: "all", label: "All", description: "Every stored report." },
  {
    key: "genuine",
    label: "Genuine",
    description: "Excludes browser-extension and browser-internal noise.",
    filter: (c) => c !== "extension" && c !== "browser-internal",
  },
  {
    key: "extension",
    label: "Extension noise",
    description: "Reports caused by user-installed browser extensions.",
    filter: (c) => c === "extension" || c === "browser-internal",
  },
  {
    key: "inline",
    label: "High signal",
    description: "Inline scripts/styles and eval — high-signal XSS indicators.",
    filter: (c) => c === "inline" || c === "eval",
  },
];

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") as View) || "all";
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports"],
    queryFn: () => listReports({ limit: 200 }),
    staleTime: 30_000,
  });

  const tab = TABS.find((t) => t.key === view) ?? TABS[0]!;

  const filtered = useMemo(() => {
    const reports = query.data?.reports ?? [];
    let list = reports;
    if (tab.filter) list = list.filter((r) => tab.filter!(r.category));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.documentUri.toLowerCase().includes(q) ||
          r.blockedUri.toLowerCase().includes(q) ||
          r.violatedDirective.toLowerCase().includes(q),
      );
    }
    return list;
  }, [query.data, tab, search]);

  const counts = useMemo(() => {
    const reports = query.data?.reports ?? [];
    const map: Record<View, number> = { all: 0, genuine: 0, extension: 0, inline: 0 };
    for (const r of reports) {
      map.all++;
      for (const t of TABS) {
        if (t.key !== "all" && t.filter && t.filter(r.category)) map[t.key]++;
      }
    }
    return map;
  }, [query.data]);

  function setView(next: View) {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
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
                <span className="ml-2 text-xs text-muted-foreground">
                  {counts[t.key]}
                </span>
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
              <TableHead className="w-[140px]">Time</TableHead>
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
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                  No reports match this view.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id} className="cursor-pointer">
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(r.timestamp), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={categoryBadgeClass(r.category)}
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

      {query.data?.cursor ? (
        <p className="text-xs text-muted-foreground">
          More results available — pagination not yet wired up; refine filters or
          query the API directly with <code>?cursor=…</code>.
        </p>
      ) : null}
    </div>
  );
}
