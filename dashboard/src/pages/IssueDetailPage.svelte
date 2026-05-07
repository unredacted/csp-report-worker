<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { format, formatDistanceToNow } from "date-fns";
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import Loader2 from "lucide-svelte/icons/loader-2";
  import Badge from "@/components/ui/Badge.svelte";
  import { buttonVariants } from "@/components/ui/Button.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardContent from "@/components/ui/CardContent.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import CardTitle from "@/components/ui/CardTitle.svelte";
  import Table from "@/components/ui/Table.svelte";
  import TableBody from "@/components/ui/TableBody.svelte";
  import TableCell from "@/components/ui/TableCell.svelte";
  import TableHead from "@/components/ui/TableHead.svelte";
  import TableHeader from "@/components/ui/TableHeader.svelte";
  import TableRow from "@/components/ui/TableRow.svelte";
  import EventBreakdown from "@/components/EventBreakdown.svelte";
  import IssueStatusBadge from "@/components/IssueStatusBadge.svelte";
  import IssueStatusControls from "@/components/IssueStatusControls.svelte";
  import Link from "@/components/Link.svelte";
  import Stat from "@/components/Stat.svelte";
  import Field from "@/components/Field.svelte";
  import { getIssue } from "@/lib/api";
  import { categoryBadgeClass, categoryLabel } from "@/lib/category";
  import { cn } from "@/lib/utils";

  let { id }: { id: string } = $props();

  const query = createQuery(() => ({
    queryKey: ["issue", id],
    queryFn: () => getIssue(id),
    enabled: Boolean(id),
  }));
</script>

<div class="space-y-4">
  <Link to="/issues" class={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
    <ArrowLeft class="size-4" />
    <span>Back to issues</span>
  </Link>

  {#if query.isLoading}
    <div class="text-muted-foreground flex items-center gap-2 text-sm">
      <Loader2 class="size-4 animate-spin" />
      Loading issue…
    </div>
  {:else if query.isError}
    <div class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      {query.error instanceof Error ? query.error.message : "Failed to load issue"}
    </div>
  {:else if query.data}
    {@const detail = query.data}
    {@const issue = detail.issue}
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center gap-3">
          <CardTitle class="font-mono text-base break-all">
            {issue.sampleTitle}
          </CardTitle>
          <IssueStatusBadge status={issue.status} />
          <Badge variant="outline" class={categoryBadgeClass(issue.category)}>
            {categoryLabel(issue.category)}
          </Badge>
          <Badge variant="secondary" class="font-mono">{issue.violatedDirective}</Badge>
        </div>
        <div class="pt-2">
          <IssueStatusControls {issue} />
        </div>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Stat label="Events" value={String(issue.eventCount)} mono />
          <Stat
            label="First seen"
            value={formatDistanceToNow(new Date(issue.firstSeen), { addSuffix: true })}
            sub={format(new Date(issue.firstSeen), "yyyy-MM-dd HH:mm")}
          />
          <Stat
            label="Last seen"
            value={formatDistanceToNow(new Date(issue.lastSeen), { addSuffix: true })}
            sub={format(new Date(issue.lastSeen), "yyyy-MM-dd HH:mm")}
          />
          <Stat label="Property" value={issue.propertyId} mono />
        </div>

        <Field label="Document URI" value={issue.documentUri} mono />
        <Field label="Blocked URI" value={issue.blockedUri || "(inline)"} mono danger />
        <Field
          label="Source"
          value={issue.sourceFile
            ? `${issue.sourceFile}${issue.lineNumber ? `:${issue.lineNumber}` : ""}${
                issue.columnNumber ? `:${issue.columnNumber}` : ""
              }`
            : "(none)"}
          mono
        />
        <Field label="Fingerprint" value={issue.fingerprint} mono />
      </CardContent>
    </Card>

    <div>
      <h2 class="text-sm font-semibold tracking-tight mb-2">
        Where these came from <span class="text-muted-foreground font-normal">(last 100 events)</span>
      </h2>
      <EventBreakdown aggregates={detail.aggregates} />
    </div>

    <div>
      <h2 class="text-sm font-semibold tracking-tight mb-2">Recent events</h2>
      <div class="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-[160px]">Time</TableHead>
              <TableHead class="w-[80px]">Country</TableHead>
              <TableHead class="w-[120px]">ASN</TableHead>
              <TableHead class="w-[80px]">Colo</TableHead>
              <TableHead>User-Agent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#if detail.events.length === 0}
              <TableRow>
                <TableCell class="text-center text-muted-foreground py-8">
                  No event samples yet.
                </TableCell>
              </TableRow>
            {:else}
              {#each detail.events as e (e.id)}
                <TableRow>
                  <TableCell class="text-muted-foreground text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(e.ts), { addSuffix: true })}
                  </TableCell>
                  <TableCell class="font-mono text-xs">{e.country ?? "—"}</TableCell>
                  <TableCell class="font-mono text-xs truncate max-w-[140px]">
                    {e.asn != null ? `AS${e.asn}` : "—"}
                  </TableCell>
                  <TableCell class="font-mono text-xs">{e.colo ?? "—"}</TableCell>
                  <TableCell class="text-xs truncate max-w-[420px]" title={e.userAgent ?? ""}>
                    {e.userAgent ?? "—"}
                  </TableCell>
                </TableRow>
              {/each}
            {/if}
          </TableBody>
        </Table>
      </div>
    </div>
  {/if}
</div>

