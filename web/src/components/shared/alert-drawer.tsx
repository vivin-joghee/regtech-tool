/**
 * Alert detail drawer — opens on alert row click and shows the full
 * scored view of the underlying transaction:
 *
 *   - Transaction summary (parties, amount, corridor, channel)
 *   - Per-jurisdiction rule hits with reasons + evidence
 *   - Contradiction status if US and SG verdicts diverged
 *   - ML score + horizontal SHAP bar chart of top contributing features
 *   - Audit fields: rule pack SHA, model SHA, persisted alert IDs
 */

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect } from "react";

import { ShapChart } from "@/components/shared/shap-chart";
import { JurisdictionBadge, VerdictBadge } from "@/components/shared/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Verdict } from "@/lib/api";
import { cn, fmtDate, fmtMoney, shortId } from "@/lib/utils";

interface AlertDrawerProps {
  transactionId: string | null;
  onClose: () => void;
}

export function AlertDrawer({ transactionId, onClose }: AlertDrawerProps) {
  const detail = useQuery({
    queryKey: ["transaction-detail", transactionId],
    queryFn: () => api.transactions.detail(transactionId!),
    enabled: transactionId !== null,
  });

  // Close on Escape
  useEffect(() => {
    if (transactionId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transactionId, onClose]);

  if (transactionId === null) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-screen w-full max-w-3xl",
          "border-l border-slate-800 bg-slate-950 shadow-2xl",
          "overflow-y-auto",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-100">
              Alert detail
            </span>
            <span className="font-mono text-xs text-slate-500">
              txn {shortId(transactionId)}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 p-5">
          {detail.isLoading && (
            <div className="text-sm text-slate-400">Loading…</div>
          )}
          {detail.isError && (
            <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
              Failed to load detail: {(detail.error as Error).message}
            </div>
          )}
          {detail.data && <DetailBody detail={detail.data} />}
        </div>
      </aside>
    </>
  );
}

function DetailBody({
  detail,
}: {
  detail: NonNullable<ReturnType<typeof api.transactions.detail> extends Promise<infer T> ? T : never>;
}) {
  const t = detail.transaction;
  const typology = (t.raw?.typology as string | undefined) ?? "—";

  return (
    <>
      {/* Plain-English explanation — server-generated narrative */}
      {detail.narrative && (
        <Section title="Plain-English explanation">
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-sm font-semibold text-slate-100 mb-3">
              {detail.narrative.headline}
            </p>
            {detail.narrative.paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-sm text-slate-300 leading-relaxed mb-2 last:mb-0 whitespace-pre-line"
              >
                {p}
              </p>
            ))}
          </div>
        </Section>
      )}

      {/* Transaction summary */}
      <Section title="Transaction">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <KV label="Occurred" value={fmtDate(t.occurredAt)} />
          <KV label="Channel" value={t.channel ?? "—"} />
          <KV
            label="Amount"
            value={fmtMoney(t.amountNative, t.currency)}
            mono
          />
          <KV label="Corridor" value={t.corridor ?? "—"} />
          <KV
            label="USD-equiv"
            value={fmtMoney(t.amountUsd, "USD")}
            mono
          />
          <KV
            label="SGD-equiv"
            value={fmtMoney(t.amountSgd, "SGD")}
            mono
          />
          <KV
            label="In scope"
            value={
              <div className="flex gap-1">
                {t.inScopeJurisdictions.map((j) => (
                  <JurisdictionBadge key={j} jurisdiction={j} />
                ))}
              </div>
            }
          />
          <KV
            label="Typology"
            value={
              <Badge
                variant={typology === "NORMAL" ? "muted" : "info"}
                className="font-mono text-[11px]"
              >
                {typology}
              </Badge>
            }
          />
        </div>
      </Section>

      {/* Counterparties */}
      {(detail.originator || detail.beneficiary) && (
        <Section title="Counterparties">
          <div className="grid gap-3 md:grid-cols-2">
            {detail.originator && (
              <PartyCard label="Originator" customer={detail.originator} />
            )}
            {detail.beneficiary && (
              <PartyCard label="Beneficiary" customer={detail.beneficiary} />
            )}
          </div>
        </Section>
      )}

      {/* Per-jurisdiction breakdown */}
      <Section title="Per-jurisdiction verdict">
        <div className="space-y-3">
          {detail.scoring.perJurisdiction.map((v) => (
            <div
              key={v.jurisdiction}
              className="rounded-md border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <JurisdictionBadge jurisdiction={v.jurisdiction} />
                  <VerdictBadge verdict={v.verdict} />
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  pack {v.rulePackSha.slice(0, 12)}
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                {v.hits.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">
                    No rules fired.
                  </div>
                ) : (
                  v.hits.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-xs"
                    >
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] shrink-0"
                      >
                        {h.ruleId}
                      </Badge>
                      <VerdictBadge verdict={h.verdict} />
                      <span className="text-slate-300">{h.reason}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Contradiction */}
      {detail.scoring.contradiction && (
        <Section title="Contradiction">
          <div className="rounded-md border border-amber-800/50 bg-amber-950/30 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">US</span>
              <VerdictBadge
                verdict={detail.scoring.contradiction.usVerdict as Verdict}
              />
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">SG</span>
              <VerdictBadge
                verdict={detail.scoring.contradiction.sgVerdict as Verdict}
              />
            </div>
            <p className="mt-2 text-xs text-slate-300">
              The two regimes reached different verdicts. The system does
              not silently pick one — resolution is human work. Status:{" "}
              <Badge variant="muted">
                {detail.persistedContradiction?.resolution ?? "—"}
              </Badge>
            </p>
          </div>
        </Section>
      )}

      {/* SHAP attributions */}
      <Section
        title={
          <>
            ML score{" "}
            <span className="ml-2 font-mono text-xs text-slate-400">
              {detail.scoring.mlScore.toFixed(4)}
            </span>
            <span className="ml-2 text-xs text-slate-500">
              · model {detail.scoring.modelSha.slice(0, 12)}
            </span>
          </>
        }
      >
        {detail.shap && Object.keys(detail.shap.shap).length > 0 ? (
          <>
            <p className="mb-2 text-xs text-slate-400">
              Top 12 contributing features for this transaction. Red
              contributions push the score toward suspicious; green
              contributions push toward benign.
            </p>
            <ShapChart values={detail.shap.shap} topN={12} height={400} />
          </>
        ) : (
          <div className="text-xs text-slate-500 italic">
            No SHAP attributions available for this transaction.
          </div>
        )}
      </Section>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-800/60 pb-1.5">
      <span className="text-slate-500">{label}</span>
      <span className={cn(mono && "font-mono", "text-slate-200 text-right")}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function PartyCard({
  label,
  customer,
}: {
  label: string;
  customer: NonNullable<
    Awaited<ReturnType<typeof api.transactions.detail>>["originator"]
  >;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-100">
        {customer.legalName}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-400">
        <span>Type</span>
        <span className="text-right text-slate-300">{customer.customerType}</span>
        <span>Domicile</span>
        <span className="text-right text-slate-300">
          {customer.domicileCountry ?? "—"}
        </span>
        <span>PEP</span>
        <span className="text-right text-slate-300">
          {customer.pepStatus ?? "—"}
        </span>
        <span>Risk rating</span>
        <span className="text-right text-slate-300">
          {customer.riskRating ?? "—"}
        </span>
        {customer.beneficialOwner && (
          <>
            <span>UBO</span>
            <span className="text-right text-amber-300">
              {customer.beneficialOwner}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
