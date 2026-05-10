import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AlertDrawer } from "@/components/shared/alert-drawer";
import { JurisdictionBadge } from "@/components/shared/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { type AlertStatus, type Jurisdiction, api } from "@/lib/api";
import { cn, fmtDate, shortId } from "@/lib/utils";

const STATUSES: AlertStatus[] = ["new", "in_review", "escalated", "dismissed", "filed"];
const SEVERITIES: { label: string; min: number; max: number }[] = [
  { label: "All", min: 0, max: 5 },
  { label: "≥ Flag (3+)", min: 3, max: 5 },
  { label: "Block only (5)", min: 5, max: 5 },
];

export function AlertsPage() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | "ALL">("ALL");
  const [status, setStatus] = useState<AlertStatus | "ALL">("ALL");
  const [severity, setSeverity] = useState<{ min: number; max: number }>({
    min: 3,
    max: 5,
  });
  const [openTxnId, setOpenTxnId] = useState<string | null>(null);

  const limit = 100;
  const alerts = useQuery({
    queryKey: ["alerts", jurisdiction, status, limit],
    queryFn: () =>
      api.alerts.list({
        jurisdiction: jurisdiction === "ALL" ? undefined : jurisdiction,
        status: status === "ALL" ? undefined : status,
        limit,
      }),
  });

  const filtered = (alerts.data?.items ?? []).filter(
    (a) => (a.severity ?? 0) >= severity.min && (a.severity ?? 0) <= severity.max,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1 text-sm text-slate-400">
          One row per rule hit. CTR-threshold rules dominate by volume — use
          the severity filter to focus on flag- or block-level alerts.
        </p>
      </div>

      <Card>
        <CardHeader className="border-b-0 pb-2">
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4 text-xs">
          <FilterGroup label="Jurisdiction">
            {(["ALL", "US", "SG"] as const).map((j) => (
              <Pill key={j} active={jurisdiction === j} onClick={() => setJurisdiction(j)}>
                {j}
              </Pill>
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            <Pill active={status === "ALL"} onClick={() => setStatus("ALL")}>
              All
            </Pill>
            {STATUSES.map((s) => (
              <Pill key={s} active={status === s} onClick={() => setStatus(s)}>
                {s}
              </Pill>
            ))}
          </FilterGroup>
          <FilterGroup label="Severity">
            {SEVERITIES.map((sev) => (
              <Pill
                key={sev.label}
                active={severity.min === sev.min && severity.max === sev.max}
                onClick={() => setSeverity({ min: sev.min, max: sev.max })}
              >
                {sev.label}
              </Pill>
            ))}
          </FilterGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            {filtered.length} {filtered.length === 1 ? "alert" : "alerts"}{" "}
            {alerts.data && (
              <span className="text-slate-500 text-xs font-normal ml-2">
                ({alerts.data.total} matching server-side filter; client-side
                severity filter applied)
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => alerts.refetch()}
            disabled={alerts.isFetching}
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Created</TH>
                <TH>Jur</TH>
                <TH>Rule</TH>
                <TH>Severity</TH>
                <TH>ML score</TH>
                <TH>Status</TH>
                <TH>Txn</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.length === 0 && (
                <TR>
                  <TD colSpan={7} className="text-center text-slate-500 py-6">
                    {alerts.isLoading ? "Loading…" : "No alerts match the filter."}
                  </TD>
                </TR>
              )}
              {filtered.map((a) => (
                <TR
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => setOpenTxnId(a.transactionId)}
                >
                  <TD className="font-mono text-xs text-slate-400">
                    {fmtDate(a.createdAt)}
                  </TD>
                  <TD>
                    <JurisdictionBadge jurisdiction={a.jurisdiction} />
                  </TD>
                  <TD className="font-mono text-xs">{a.ruleId}</TD>
                  <TD>
                    <SeverityBadge severity={a.severity} />
                  </TD>
                  <TD className="font-mono text-xs text-slate-300">
                    {a.mlScore ? Number(a.mlScore).toFixed(4) : "—"}
                  </TD>
                  <TD>
                    <Badge variant="muted">{a.status}</Badge>
                  </TD>
                  <TD className="font-mono text-xs text-slate-400">
                    {shortId(a.transactionId)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDrawer
        transactionId={openTxnId}
        onClose={() => setOpenTxnId(null)}
      />
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{label}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 transition-colors",
        active
          ? "bg-orange-600 text-white"
          : "bg-slate-800 text-slate-300 hover:bg-slate-700",
      )}
    >
      {children}
    </button>
  );
}

function SeverityBadge({ severity }: { severity: number | null }) {
  if (severity === null) return <Badge variant="muted">—</Badge>;
  if (severity >= 5) return <Badge variant="block">{severity} block</Badge>;
  if (severity >= 3) return <Badge variant="flag">{severity} flag</Badge>;
  return <Badge variant="allow">{severity}</Badge>;
}
