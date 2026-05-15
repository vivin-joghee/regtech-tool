import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/utils";

export function DashboardPage() {
  const queryClient = useQueryClient();

  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const txns = useQuery({
    queryKey: ["transactions", { limit: 1 }],
    queryFn: () => api.transactions.list({ limit: 1 }),
  });
  const alertsAll = useQuery({
    queryKey: ["alerts", "count"],
    queryFn: () => api.alerts.list({ limit: 1 }),
  });
  const alertsUS = useQuery({
    queryKey: ["alerts", "count", "US"],
    queryFn: () => api.alerts.list({ jurisdiction: "US", limit: 1 }),
  });
  const alertsSG = useQuery({
    queryKey: ["alerts", "count", "SG"],
    queryFn: () => api.alerts.list({ jurisdiction: "SG", limit: 1 }),
  });
  const contradictionsAll = useQuery({
    queryKey: ["contradictions", "count"],
    queryFn: () => api.contradictions.list({ limit: 1 }),
  });
  const contradictionsPending = useQuery({
    queryKey: ["contradictions", "count", "pending"],
    queryFn: () => api.contradictions.list({ status: "pending", limit: 1 }),
  });

  const replay = useMutation({
    mutationFn: api.transactions.replayAll,
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live counts from Neon. Replay re-scores every transaction in the
            dataset against the current rule packs and the deployed model.
          </p>
        </div>
        <Button
          onClick={() => replay.mutate()}
          disabled={replay.isPending}
          variant="default"
        >
          {replay.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Replay all
        </Button>
      </div>

      {replay.data && (
        <div className="rounded-md border border-emerald-800/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          Replay complete — scored {replay.data.scored.toLocaleString()}{" "}
          transactions, wrote {replay.data.alerts_written.toLocaleString()}{" "}
          alerts and {replay.data.contradictions_written} contradictions.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Transactions"
          value={txns.data?.total ?? "—"}
          subtitle="in dataset"
        />
        <StatCard
          title="Alerts (total)"
          value={alertsAll.data?.total ?? "—"}
          subtitle={`US ${alertsUS.data?.total ?? "—"} · SG ${alertsSG.data?.total ?? "—"}`}
        />
        <StatCard
          title="Contradictions"
          value={contradictionsAll.data?.total ?? "—"}
          subtitle={`${contradictionsPending.data?.total ?? "—"} pending review`}
          variant="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active versions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <KV label="US rule pack" value={health.data?.rule_packs.US.sha} mono />
          <KV label="SG rule pack" value={health.data?.rule_packs.SG.sha} mono />
          <KV
            label="Model SHA-256"
            value={health.data?.model.model_sha256.slice(0, 16)}
            mono
          />
          <KV
            label="Model trained at"
            value={
              health.data?.model.computed_at
                ? fmtDate(health.data.model.computed_at)
                : "—"
            }
          />
          <KV
            label="Predictions cached"
            value={
              health.data
                ? `${health.data.model.transaction_count} txns / ${health.data.model.feature_count} features`
                : "—"
            }
          />
          <KV
            label="SHAP method"
            value={health.data?.model.shap_method ?? "—"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the contradictions count means</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          <p>
            Each contradiction is a transaction where the US and Singapore
            rule packs reached <em>different verdicts</em>. The tool does NOT
            silently pick one — every contradiction must be resolved by a
            human reviewer.
          </p>
          <p>
            Two patterns dominate: <Badge variant="info">CTR asymmetry</Badge>{" "}
            divergences (US flags cash transactions over $10K under{" "}
            31 CFR §1010.311; Singapore has no equivalent general bank CTR
            rule, so the same transaction in dual scope produces{" "}
            <em>US flag / SG allow</em>) and{" "}
            <Badge variant="block">OFAC-only</Badge> sanctions (a counterparty
            on OFAC SDN but not on MAS TFS produces a US block / SG flag
            split).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  variant,
}: {
  title: string;
  value: number | string;
  subtitle: string;
  variant?: "amber";
}) {
  return (
    <Card>
      <CardHeader className="border-b-0 pb-1">
        <CardTitle className="text-xs uppercase tracking-wide text-slate-400">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className={
            variant === "amber"
              ? "text-3xl font-semibold tracking-tight text-amber-300"
              : "text-3xl font-semibold tracking-tight text-slate-100"
          }
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
      </CardContent>
    </Card>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-2 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className={mono ? "font-mono text-slate-200" : "text-slate-200"}>
        {value ?? "—"}
      </span>
    </div>
  );
}
