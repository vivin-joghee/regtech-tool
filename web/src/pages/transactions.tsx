import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AlertDrawer } from "@/components/shared/alert-drawer";
import { JurisdictionBadge } from "@/components/shared/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDate, fmtMoney, shortId } from "@/lib/utils";

export function TransactionsPage() {
  const [offset, setOffset] = useState(0);
  const [openTxnId, setOpenTxnId] = useState<string | null>(null);
  const limit = 50;

  const data = useQuery({
    queryKey: ["transactions", limit, offset],
    queryFn: () => api.transactions.list({ limit, offset }),
  });

  const items = data.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        <p className="mt-1 text-sm text-slate-400">
          Full dataset, ordered by occurred-at descending. Phase A.2 will add
          filter pills, search, and the per-row "score" preview.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            Showing {offset + 1}–{Math.min(offset + limit, data.data?.total ?? 0)}{" "}
            of {data.data?.total ?? "—"}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset + limit)}
              disabled={!data.data || offset + limit >= data.data.total}
            >
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Occurred</TH>
                <TH>Typology</TH>
                <TH>Amount</TH>
                <TH>Corridor</TH>
                <TH>Channel</TH>
                <TH>In scope</TH>
                <TH>Sanctions</TH>
                <TH>Txn</TH>
              </TR>
            </THead>
            <TBody>
              {items.length === 0 && (
                <TR>
                  <TD colSpan={8} className="text-center text-slate-500 py-6">
                    {data.isLoading ? "Loading…" : "No transactions."}
                  </TD>
                </TR>
              )}
              {items.map((t) => {
                const typology =
                  (t.raw?.scenario_category as string | undefined) ??
                  (t.raw?.typology as string | undefined) ??
                  "—";
                const ofac = Boolean(t.raw?.ofac_sdn_match);
                const mas = Boolean(t.raw?.mas_tfs_match);
                return (
                  <TR
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => setOpenTxnId(t.id)}
                  >
                    <TD className="font-mono text-xs text-slate-400">
                      {fmtDate(t.occurredAt)}
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
                      {fmtMoney(t.amountNative, t.currency)}
                    </TD>
                    <TD className="text-xs text-slate-400">
                      {t.corridor ?? "—"}
                    </TD>
                    <TD className="text-xs text-slate-400">
                      {t.channel ?? "—"}
                    </TD>
                    <TD>
                      <div className="flex gap-1">
                        {t.inScopeJurisdictions.map((j) => (
                          <JurisdictionBadge key={j} jurisdiction={j} />
                        ))}
                      </div>
                    </TD>
                    <TD className="space-x-1">
                      {ofac && <Badge variant="block">OFAC</Badge>}
                      {mas && <Badge variant="flag">MAS</Badge>}
                      {!ofac && !mas && (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">
                      {shortId(t.id)}
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
