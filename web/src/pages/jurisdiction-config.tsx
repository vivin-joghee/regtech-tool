import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type Jurisdiction, api, type JurisdictionPackResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export function JurisdictionConfigPage() {
  const [active, setActive] = useState<Jurisdiction>("US");

  const data = useQuery({
    queryKey: ["jurisdiction", active],
    queryFn: () => api.jurisdictions.one(active),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Rule packs</h1>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          The exact YAML files that govern every alert. SHA-256 of each file
          is computed at module init and recorded on every alert in
          Postgres, so a rule change is always traceable to a specific
          deployed version. This is the examiner-facing surface.
        </p>
      </div>

      <div className="flex gap-2">
        {(["US", "SG"] as const).map((j) => (
          <button
            key={j}
            onClick={() => setActive(j)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm transition-colors",
              active === j
                ? "bg-orange-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700",
            )}
          >
            {j === "US" ? "United States" : "Singapore"}
          </button>
        ))}
      </div>

      {data.data && <PackView pack={data.data} />}
    </div>
  );
}

function PackView({ pack: data }: { pack: JurisdictionPackResponse }) {
  const p = data.pack;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Parsed view */}
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>{p.human_label}</CardTitle>
            <CardDescription>
              Schema v{p.schema_version} · {p.authority} ·{" "}
              <span className="font-mono">{data.sha.slice(0, 16)}…</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <KV label="Examiners">{p.prudential_examiners.join(", ")}</KV>
            <KV label="Statute">
              <ul className="list-disc pl-5">
                {p.statute.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </KV>
            {p.direction_of_travel_2026 && (
              <KV label="2026 direction">
                <Badge variant="info">{p.direction_of_travel_2026}</Badge>
              </KV>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rules in force</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <RuleRow
              label="Sanctions"
              ruleId="(per match)"
              detail={`Primary: ${p.sanctions.primary_list}${
                p.sanctions.also_apply?.length
                  ? "; also: " + p.sanctions.also_apply.join(", ")
                  : ""
              } → ${p.sanctions.triggers_verdict.toUpperCase()}`}
            />
            {p.currency_transaction ? (
              <RuleRow
                label="Currency Transaction Report"
                ruleId={p.currency_transaction.rule_id}
                detail={`Threshold ${p.currency_transaction.threshold_native?.toLocaleString() ?? "—"} ${p.currency_transaction.native_currency} → ${p.currency_transaction.triggers_verdict.toUpperCase()}`}
                citation={p.currency_transaction.citation}
              />
            ) : (
              <RuleRow
                label="Currency Transaction Report"
                ruleId="N/A"
                detail="No general Currency Transaction Report rule in this jurisdiction. Bank cash reporting relies on the suspicion-based STR rule below."
              />
            )}
            {(p.suspicious_activity ?? p.suspicious_transaction) && (
              <RuleRow
                label={
                  p.suspicious_activity
                    ? "Suspicious Activity Report (US)"
                    : "Suspicious Transaction Report (SG)"
                }
                ruleId={
                  (p.suspicious_activity ?? p.suspicious_transaction)!.rule_id
                }
                detail={`Threshold ${
                  (p.suspicious_activity ?? p.suspicious_transaction)!
                    .threshold_native?.toLocaleString() ?? "no monetary floor"
                } ${
                  (p.suspicious_activity ?? p.suspicious_transaction)!
                    .native_currency
                } → ${
                  (p.suspicious_activity ?? p.suspicious_transaction)!
                    .triggers_verdict.toUpperCase()
                }`}
                citation={
                  (p.suspicious_activity ?? p.suspicious_transaction)!.citation
                }
              />
            )}
            <RuleRow
              label="PEP screening"
              ruleId={p.pep.rule_id}
              detail={`Scope: ${p.pep.scope.replace(/_/g, " ")} → ${p.pep.triggers_verdict.toUpperCase()}`}
              citation={p.pep.citation}
            />
            <RuleRow
              label="ML score"
              ruleId={p.ml_score.rule_id}
              detail={`Threshold ${p.ml_score.threshold} → ${p.ml_score.triggers_verdict.toUpperCase()}`}
            />
          </CardContent>
        </Card>
      </div>

      {/* Raw YAML */}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Raw YAML</CardTitle>
          <CardDescription>
            Source of truth — examiners can read this directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300 max-h-[700px]">
            <code>{data.raw_yaml}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-800 pb-2 last:border-0">
      <span className="text-slate-400">{label}</span>
      <div className="text-slate-200">{children}</div>
    </div>
  );
}

function RuleRow({
  label,
  ruleId,
  detail,
  citation,
}: {
  label: string;
  ruleId: string;
  detail: string;
  citation?: string;
}) {
  return (
    <div className="rounded-md border border-slate-800 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-100">{label}</div>
        <Badge variant="outline" className="font-mono text-[11px]">
          {ruleId}
        </Badge>
      </div>
      <div className="mt-1 text-xs text-slate-300">{detail}</div>
      {citation && (
        <div className="mt-1 text-xs text-slate-500 italic">{citation}</div>
      )}
    </div>
  );
}
