import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { AlertDrawer } from "@/components/shared/alert-drawer";
import { VerdictBadge } from "@/components/shared/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDate, fmtMoney, shortId } from "@/lib/utils";

export function ContradictionsPage() {
  const [openTxnId, setOpenTxnId] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ["contradictions"],
    queryFn: () => api.contradictions.list({ limit: 200 }),
  });

  const items = data.data?.items ?? [];

  // Group by verdict pair so the structural pattern is obvious
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.contradiction.usVerdict}→${it.contradiction.sgVerdict}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Jurisdictional contradictions
        </h1>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          Transactions where the US and Singapore rule packs reached
          different verdicts. The tool does <em>not</em> silently choose one
          regime; resolving these is human work. The structural patterns
          below should be the dominant content of any examiner walkthrough.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[...groups.entries()].map(([pair, rows]) => {
          const [us, sg] = pair.split("→") as [string, string];
          return (
            <Card key={pair}>
              <CardHeader className="border-b-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                  <span>US</span>
                  <VerdictBadge verdict={us as never} />
                  <ArrowRight className="h-3 w-3 text-slate-600" />
                  <span>SG</span>
                  <VerdictBadge verdict={sg as never} />
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-3xl font-semibold tracking-tight text-slate-100">
                  {rows.length}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {pair === "flag→allow" &&
                    "Threshold divergence (US CTR fires; SG CTR does not)"}
                  {pair === "block→flag" &&
                    "OFAC-only sanctions (US blocks; SG flags only)"}
                  {pair === "allow→flag" &&
                    "SG-only signal (e.g. domestic PEP not in US scope)"}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            All contradictions
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({data.data?.total ?? "—"} total)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Created</TH>
                <TH>Typology</TH>
                <TH>Amount</TH>
                <TH>Corridor</TH>
                <TH>US</TH>
                <TH>SG</TH>
                <TH>Status</TH>
                <TH>Txn</TH>
              </TR>
            </THead>
            <TBody>
              {items.length === 0 && (
                <TR>
                  <TD colSpan={8} className="text-center text-slate-500 py-6">
                    {data.isLoading
                      ? "Loading…"
                      : "No contradictions yet — replay transactions from the dashboard to populate this view."}
                  </TD>
                </TR>
              )}
              {items.map((it) => {
                const c = it.contradiction;
                const t = it.transaction;
                const typology =
                  (t?.raw?.scenario_category as string | undefined) ??
                  (t?.raw?.typology as string | undefined) ??
                  "—";
                return (
                  <TR
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => setOpenTxnId(c.transactionId)}
                  >
                    <TD className="font-mono text-xs text-slate-400">
                      {fmtDate(c.createdAt)}
                    </TD>
                    <TD>
                      <Badge
                        variant={typology === "NORMAL" ? "muted" : "info"}
                        className="font-mono text-[11px]"
                      >
                        {typology}
                      </Badge>
                    </TD>
                    <TD className="font-mono text-xs text-slate-200">
                      {t
                        ? fmtMoney(t.amountNative, t.currency)
                        : "—"}
                    </TD>
                    <TD className="text-xs text-slate-400">
                      {t?.corridor ?? "—"}
                    </TD>
                    <TD>
                      <VerdictBadge verdict={c.usVerdict} />
                    </TD>
                    <TD>
                      <VerdictBadge verdict={c.sgVerdict} />
                    </TD>
                    <TD>
                      <Badge variant="muted">{c.resolution}</Badge>
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">
                      {shortId(c.transactionId)}
                    </TD>
                  </TR>
                );
              })}
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
