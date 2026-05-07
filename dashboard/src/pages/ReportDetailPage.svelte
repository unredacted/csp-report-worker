<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { format } from "date-fns";
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import Loader2 from "lucide-svelte/icons/loader-2";
  import Badge from "@/components/ui/Badge.svelte";
  import { buttonVariants } from "@/components/ui/Button.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardContent from "@/components/ui/CardContent.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import CardTitle from "@/components/ui/CardTitle.svelte";
  import Link from "@/components/Link.svelte";
  import { getReport } from "@/lib/api";
  import { categoryBadgeClass, categoryLabel } from "@/lib/category";
  import { cn } from "@/lib/utils";

  let { id }: { id: string } = $props();

  const query = createQuery(() => ({
    queryKey: ["report", id],
    queryFn: () => getReport(id),
    enabled: Boolean(id),
  }));
</script>

<div class="space-y-4">
  <Link
    to="/list"
    class={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
  >
    <ArrowLeft class="size-4" />
    <span>Back to reports</span>
  </Link>

  {#if query.isLoading}
    <div class="text-muted-foreground flex items-center gap-2 text-sm">
      <Loader2 class="size-4 animate-spin" />
      Loading report…
    </div>
  {:else if query.isError}
    <div class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      {query.error instanceof Error ? query.error.message : "Failed to load report"}
    </div>
  {:else if query.data}
    {@const report = query.data}
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center gap-3">
          <CardTitle class="font-mono text-base">
            {report.violatedDirective || "(unknown directive)"}
          </CardTitle>
          <Badge variant="outline" class={categoryBadgeClass(report.category)}>
            {categoryLabel(report.category)}
          </Badge>
          <Badge variant={report.disposition === "report" ? "secondary" : "destructive"}>
            {report.disposition === "report" ? "Report only" : "Enforce"}
          </Badge>
          <span class="text-xs text-muted-foreground ml-auto">
            {format(new Date(report.timestamp), "yyyy-MM-dd HH:mm:ss")}
          </span>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Document URI</div>
          <div class="break-all font-mono text-xs">{report.documentUri}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Blocked URI</div>
          <div class="break-all font-mono text-xs text-destructive font-medium">
            {report.blockedUri || "(inline)"}
          </div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Effective Directive</div>
          <div class="break-all font-mono text-xs">{report.effectiveDirective}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Source</div>
          <div class="break-all font-mono text-xs">
            {#if report.sourceFile}
              {report.sourceFile}{report.lineNumber ? `:${report.lineNumber}` : ""}{report.columnNumber
                ? `:${report.columnNumber}`
                : ""}
            {:else}
              (none)
            {/if}
          </div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Referrer</div>
          <div class="break-all font-mono text-xs">{report.referrer || "(none)"}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">User Agent</div>
          <div class="break-all">{report.userAgent || "(none)"}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Status Code</div>
          <div class="break-all">{report.statusCode ? String(report.statusCode) : "—"}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Format</div>
          <div class="break-all">{report.sourceFormat}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] gap-3 text-sm">
          <div class="text-muted-foreground">Report ID</div>
          <div class="break-all font-mono text-xs">{report.id}</div>
        </div>
        <details class="rounded-md border bg-muted/40 p-3">
          <summary class="cursor-pointer text-sm font-medium">Original policy</summary>
          <pre class="mt-2 whitespace-pre-wrap break-all text-xs font-mono">{report.originalPolicy}</pre>
        </details>
      </CardContent>
    </Card>
  {/if}
</div>
