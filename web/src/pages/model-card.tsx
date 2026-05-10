/**
 * Model card page — renders the bundled model-metadata.json as an
 * examiner-readable governance document. Implements the Option A
 * "model card / governance documentation stub" requirement and aligns
 * with OCC 2026-13's expectation that model purpose, assumptions,
 * failure modes, and validation history be accessible by inspection.
 */

import { useQuery } from "@tanstack/react-query";

import { ShapChart } from "@/components/shared/shap-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, type ModelCard } from "@/lib/api";
import { fmtDate } from "@/lib/utils";

export function ModelCardPage() {
  const card = useQuery({ queryKey: ["model-card"], queryFn: api.modelCard });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Model card</h1>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          Governance documentation for the deployed AML scorer. Mirrors the
          OCC 2026-13 framework — purpose, assumptions, failure modes,
          validation results — and is the canonical artifact the rule engine
          references via the model SHA on every alert.
        </p>
      </div>

      {card.isLoading && (
        <div className="text-sm text-slate-400">Loading…</div>
      )}
      {card.isError && (
        <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
          Failed to load model card: {(card.error as Error).message}
        </div>
      )}
      {card.data && <Body card={card.data} />}
    </div>
  );
}

function Body({ card }: { card: ModelCard }) {
  const m = card.metrics;
  const recallEntries = Object.entries(m.recall_by_typology);
  const jurEntries = Object.entries(card.jurisdiction_validation);

  return (
    <>
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <KV
            label="SHA-256"
            value={
              <span className="font-mono text-xs">
                {card.model_sha256.slice(0, 32)}…
              </span>
            }
          />
          <KV label="Type" value={card.model_type} />
          <KV label="Trained at" value={fmtDate(card.trained_at)} />
          <KV label="Best iteration" value={String(card.best_iteration)} />
          <KV
            label="Train / Test"
            value={`${card.n_train} / ${card.n_test}`}
          />
          <KV
            label="Training positive rate"
            value={`${(card.training_window.positive_rate * 100).toFixed(2)}% (${card.training_window.positive_count}/${card.training_window.transaction_count})`}
          />
        </CardContent>
      </Card>

      {/* Purpose / assumptions / failure modes — pulled from architecture §8 */}
      <Card>
        <CardHeader>
          <CardTitle>Purpose</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300 space-y-2">
          <p>
            Detects transactions consistent with money-laundering typologies
            in cross-border USD/SGD corridors at mid-tier APAC banks
            supervised by MAS, with parallel applicability for the bank's
            US-branch BSA obligations. Surfaces a probability and the
            top-contributing features for every transaction.
          </p>
          <p className="italic text-slate-400">
            Does NOT make a filing decision — that remains with the human
            MLRO. Outputs feed into the rule engine, not directly into
            SAR/STR drafts.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assumptions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Input transactions follow ISO 20022 message structure (or a
              documented mapping).
            </li>
            <li>
              Customer KYC has been performed upstream — this model does not
              onboard.
            </li>
            <li>
              Sanctions list snapshots are no more than 24 hours stale.
            </li>
            <li>
              Decision threshold of <Badge variant="info" className="font-mono">{m.decision_threshold.toFixed(4)}</Badge>{" "}
              was auto-tuned on the test set to maximize F1; with{" "}
              <code className="text-slate-200">scale_pos_weight</code> applied
              during training, raw probabilities are <em>shifted</em> and
              should not be interpreted as calibrated probabilities.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where the model can fail</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Novel typologies not in the training distribution</strong>{" "}
              — silent false negative.
            </li>
            <li>
              <strong>
                Customers whose business model legitimately resembles a
                layering pattern
              </strong>{" "}
              — silent false positive, with downstream debanking risk for
              SMEs in correspondent corridors (Task 2 §4(a)).
            </li>
            <li>
              <strong>Jurisdictional misconfiguration</strong> — architectural
              mitigation: every alert records the rule pack SHA in force at
              scoring time.
            </li>
            <li>
              <strong>GenAI / agentic AI</strong> — out of scope by design.
              OCC 2026-13 explicitly excludes them; we do not use them.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Performance on holdout</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <Stat label="ROC-AUC" value={m.roc_auc.toFixed(4)} />
          <Stat label="PR-AUC" value={m.pr_auc.toFixed(4)} />
          <Stat
            label="Decision threshold"
            value={m.decision_threshold.toFixed(4)}
          />
          <Stat
            label="True positive"
            value={String(m.n_true_positive)}
            sublabel={`of ${m.n_test_positive}`}
          />
          <Stat
            label="False positive"
            value={String(m.n_false_positive)}
            tone="amber"
          />
          <Stat
            label="False negative"
            value={String(m.n_false_negative)}
            tone="red"
          />
        </CardContent>
      </Card>

      {/* Recall by typology */}
      <Card>
        <CardHeader>
          <CardTitle>Recall by typology (holdout)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Typology</TH>
                <TH className="text-right">Caught</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Recall</TH>
              </TR>
            </THead>
            <TBody>
              {recallEntries.length === 0 && (
                <TR>
                  <TD colSpan={4} className="text-center text-slate-500 py-3">
                    No typology-positive samples in holdout.
                  </TD>
                </TR>
              )}
              {recallEntries.map(([typ, v]) => (
                <TR key={typ}>
                  <TD>
                    <Badge variant="info" className="font-mono text-[11px]">
                      {typ}
                    </Badge>
                  </TD>
                  <TD className="text-right font-mono">{v.n_caught}</TD>
                  <TD className="text-right font-mono">{v.n_total}</TD>
                  <TD
                    className={`text-right font-mono ${v.recall >= 0.7 ? "text-emerald-300" : v.recall >= 0.3 ? "text-amber-300" : "text-red-300"}`}
                  >
                    {(v.recall * 100).toFixed(0)}%
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="px-4 py-3 text-xs text-slate-500 italic border-t border-slate-800">
            Holdout has only {m.n_test_positive} positive samples across all
            typologies — recall numbers are informative but noisy. Cross-
            validation results will be reported in Phase 2 of training.
          </p>
        </CardContent>
      </Card>

      {/* Jurisdictional validation */}
      <Card>
        <CardHeader>
          <CardTitle>Jurisdictional validation</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>In scope</TH>
                <TH className="text-right">N</TH>
                <TH className="text-right">Mean score</TH>
                <TH className="text-right">P95 score</TH>
                <TH className="text-right">Above 0.5</TH>
              </TR>
            </THead>
            <TBody>
              {jurEntries.map(([k, v]) => (
                <TR key={k}>
                  <TD className="font-mono text-xs">{k}</TD>
                  <TD className="text-right font-mono">{v.n}</TD>
                  <TD className="text-right font-mono">
                    {v.mean_score.toFixed(4)}
                  </TD>
                  <TD className="text-right font-mono">
                    {v.p95_score.toFixed(4)}
                  </TD>
                  <TD className="text-right font-mono">
                    {v.n_above_threshold_0_5}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="px-4 py-3 text-xs text-slate-500 italic border-t border-slate-800">
            Score distributions across the three in-scope groupings. Useful
            for the Task 4 question "is the model uniform across
            jurisdictions or is one regime systematically over-flagged?"
          </p>
        </CardContent>
      </Card>

      {/* Global SHAP importance */}
      <Card>
        <CardHeader>
          <CardTitle>Global feature importance (mean |SHAP|)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-slate-400">
            Average absolute SHAP across all training transactions — the
            features the model relies on most when making any decision.
          </p>
          <ShapChart values={card.shap_baseline} topN={20} height={520} absolute />
        </CardContent>
      </Card>

      {/* Hyperparameters */}
      <Card>
        <CardHeader>
          <CardTitle>Hyperparameters</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
            <code>{JSON.stringify(card.hyperparameters, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>

      {/* Features used */}
      <Card>
        <CardHeader>
          <CardTitle>Features ({card.features.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {card.features.map((f) => (
              <Badge
                key={f}
                variant="outline"
                className="font-mono text-[10px]"
              >
                {f}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-800 pb-1.5 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "amber" | "red";
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          tone === "amber"
            ? "text-amber-300"
            : tone === "red"
              ? "text-red-300"
              : "text-slate-100"
        }`}
      >
        {value}
      </div>
      {sublabel && (
        <div className="mt-0.5 text-xs text-slate-500">{sublabel}</div>
      )}
    </div>
  );
}
