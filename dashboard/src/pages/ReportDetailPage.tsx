import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getReport } from "@/lib/api";
import { categoryBadgeClass, categoryLabel } from "@/lib/category";

export function ReportDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({
    queryKey: ["report", id],
    queryFn: () => getReport(id),
    enabled: Boolean(id),
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/list">
          <ArrowLeft className="size-4" />
          <span>Back to reports</span>
        </Link>
      </Button>

      {query.isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading report…
        </div>
      ) : query.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {query.error instanceof Error ? query.error.message : "Failed to load report"}
        </div>
      ) : query.data ? (
        <ReportCard report={query.data} />
      ) : null}
    </div>
  );
}

function ReportCard({ report }: { report: import("@/lib/types").NormalisedReport }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="font-mono text-base">
            {report.violatedDirective || "(unknown directive)"}
          </CardTitle>
          <Badge variant="outline" className={categoryBadgeClass(report.category)}>
            {categoryLabel(report.category)}
          </Badge>
          <Badge variant={report.disposition === "report" ? "secondary" : "destructive"}>
            {report.disposition === "report" ? "Report only" : "Enforce"}
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto">
            {format(new Date(report.timestamp), "yyyy-MM-dd HH:mm:ss")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Document URI" value={report.documentUri} mono />
        <Field
          label="Blocked URI"
          value={report.blockedUri || "(inline)"}
          mono
          danger
        />
        <Field label="Effective Directive" value={report.effectiveDirective} mono />
        <Field
          label="Source"
          value={
            report.sourceFile
              ? `${report.sourceFile}${report.lineNumber ? `:${report.lineNumber}` : ""}${
                  report.columnNumber ? `:${report.columnNumber}` : ""
                }`
              : "(none)"
          }
          mono
        />
        <Field label="Referrer" value={report.referrer || "(none)"} mono />
        <Field label="User Agent" value={report.userAgent || "(none)"} />
        <Field label="Status Code" value={report.statusCode ? String(report.statusCode) : "—"} />
        <Field label="Format" value={report.sourceFormat} />
        <Field label="Report ID" value={report.id} mono />
        <details className="rounded-md border bg-muted/40 p-3">
          <summary className="cursor-pointer text-sm font-medium">Original policy</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all text-xs font-mono">
            {report.originalPolicy}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  mono,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div
        className={[
          "break-all",
          mono ? "font-mono text-xs" : "",
          danger ? "text-destructive font-medium" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
