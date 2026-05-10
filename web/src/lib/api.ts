/**
 * Typed API client. All Worker endpoints surface here so TypeScript
 * catches contract drift between server and client.
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text || path}`);
  }
  return res.json() as Promise<T>;
}

/* -------------------------------------------------------------------------- */
/*  Types — mirror what the Worker returns. Keep in sync with worker/src.     */
/* -------------------------------------------------------------------------- */

export type Jurisdiction = "US" | "SG";
export type Verdict = "block" | "flag" | "allow";
export type AlertStatus = "new" | "in_review" | "escalated" | "dismissed" | "filed";

export interface HealthResponse {
  status: string;
  rule_packs: Record<Jurisdiction, { sha: string; schema_version: number }>;
  model: {
    schema_version: number;
    model_sha256: string;
    computed_at: string;
    shap_method: string;
    feature_count: number;
    transaction_count: number;
    base_value: number;
  };
  timestamp: string;
}

export interface RulePack {
  jurisdiction: Jurisdiction;
  schema_version: number;
  human_label: string;
  authority: string;
  prudential_examiners: string[];
  statute: string[];
  sanctions: { primary_list: string; also_apply?: string[]; triggers_verdict: Verdict };
  // Optional — not every jurisdiction has a CTR rule. Singapore omits it
  // (bank cash reporting is purely suspicion-based via STR / CDSA s.45).
  currency_transaction?: {
    threshold_native: number | null;
    native_currency: "USD" | "SGD";
    triggers_verdict: Verdict;
    rule_id: string;
    citation?: string;
  };
  suspicious_activity?: NonNullable<RulePack["currency_transaction"]>;
  suspicious_transaction?: NonNullable<RulePack["currency_transaction"]>;
  pep: {
    scope: "foreign_only" | "foreign_and_domestic";
    triggers_verdict: Verdict;
    rule_id: string;
    citation?: string;
  };
  ml_score: { threshold: number; triggers_verdict: Verdict; rule_id: string };
  ai_governance?: Record<string, unknown>;
  direction_of_travel_2026?: string;
}

export interface JurisdictionPackResponse {
  sha: string;
  pack: RulePack;
  raw_yaml?: string;
}

export interface Transaction {
  id: string;
  originatorId: string | null;
  beneficiaryId: string | null;
  amountNative: string;
  currency: string;
  amountUsd: string | null;
  amountSgd: string | null;
  corridor: string | null;
  channel: string | null;
  inScopeJurisdictions: Jurisdiction[];
  raw: Record<string, unknown> & {
    typology?: string;
    ofac_sdn_match?: boolean;
    mas_tfs_match?: boolean;
    note?: string;
    originator_alias?: string;
    beneficiary_alias?: string;
    originator_pep?: string;
    beneficiary_pep?: string;
  };
  occurredAt: string;
  createdAt: string;
}

export interface TransactionsResponse {
  limit: number;
  offset: number;
  total: number;
  items: Transaction[];
}

export interface Alert {
  id: string;
  transactionId: string;
  jurisdiction: Jurisdiction;
  ruleId: string;
  severity: number | null;
  mlScore: string | null;
  shapAttribution: Record<string, number> | null;
  rulePackSha: string;
  modelSha: string;
  status: AlertStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  overrideReason: string | null;
  createdAt: string;
}

export interface AlertsResponse {
  limit: number;
  offset: number;
  total: number;
  items: Alert[];
}

export interface ContradictionWithTransaction {
  contradiction: {
    id: string;
    transactionId: string;
    usVerdict: Verdict;
    sgVerdict: Verdict;
    resolution: string;
    resolvedBy: string | null;
    resolvedAt: string | null;
    rationale: string | null;
    createdAt: string;
  };
  transaction: Transaction | null;
}

export interface ContradictionsResponse {
  limit: number;
  offset: number;
  total: number;
  items: ContradictionWithTransaction[];
}

export interface Customer {
  id: string;
  legalName: string;
  customerType: string;
  domicileCountry: string | null;
  beneficialOwner: string | null;
  pepStatus: string | null;
  riskRating: number | null;
  onboardedAt: string;
}

export interface TransactionDetail {
  transaction: Transaction;
  originator: Customer | null;
  beneficiary: Customer | null;
  scoring: ScoringResult;
  persistedAlerts: Alert[];
  persistedContradiction: {
    id: string;
    transactionId: string;
    usVerdict: Verdict;
    sgVerdict: Verdict;
    resolution: string;
    resolvedBy: string | null;
    resolvedAt: string | null;
    rationale: string | null;
    createdAt: string;
  } | null;
  shap: {
    score: number;
    shap: Record<string, number>;
    modelSha: string;
  } | null;
  narrative?: {
    headline: string;
    paragraphs: string[];
    contradiction_explanation: string | null;
  };
}

export interface ModelCard {
  model_sha256: string;
  model_type: string;
  trained_at: string;
  n_train: number;
  n_test: number;
  best_iteration: number;
  features: string[];
  metrics: {
    decision_threshold: number;
    roc_auc: number;
    pr_auc: number;
    n_test_total: number;
    n_test_positive: number;
    n_predicted_positive: number;
    n_true_positive: number;
    n_false_positive: number;
    n_false_negative: number;
    recall_by_typology: Record<
      string,
      { n_total: number; n_caught: number; recall: number }
    >;
  };
  shap_baseline: Record<string, number>;
  jurisdiction_validation: Record<
    string,
    {
      n: number;
      mean_score: number;
      p95_score: number;
      n_above_threshold_0_5: number;
    }
  >;
  hyperparameters: Record<string, unknown>;
  training_window: {
    transaction_count: number;
    positive_count: number;
    positive_rate: number;
  };
}

export interface ScoringResult {
  transactionId: string;
  perJurisdiction: {
    jurisdiction: Jurisdiction;
    verdict: Verdict;
    hits: {
      ruleId: string;
      verdict: Verdict;
      reason: string;
      evidence: Record<string, unknown>;
    }[];
    rulePackSha: string;
  }[];
  contradiction: { usVerdict: Verdict; sgVerdict: Verdict } | null;
  mlScore: number;
  modelSha: string;
}

/* -------------------------------------------------------------------------- */
/*  Endpoints                                                                 */
/* -------------------------------------------------------------------------- */

export const api = {
  health: () => request<HealthResponse>("/api/health"),

  jurisdictions: {
    all: () =>
      request<Record<Jurisdiction, JurisdictionPackResponse>>(
        "/api/jurisdiction-config",
      ),
    one: (code: Jurisdiction) =>
      request<JurisdictionPackResponse>(`/api/jurisdiction-config/${code}`),
  },

  transactions: {
    list: (params: { limit?: number; offset?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.limit !== undefined) q.set("limit", String(params.limit));
      if (params.offset !== undefined) q.set("offset", String(params.offset));
      return request<TransactionsResponse>(`/api/transactions?${q.toString()}`);
    },
    detail: (id: string) =>
      request<TransactionDetail>(`/api/transactions/${id}/detail`),
    replay: (id: string) =>
      request<ScoringResult>(`/api/transactions/${id}/replay`, {
        method: "POST",
      }),
    replayAll: () =>
      request<{
        scored: number;
        alerts_written: number;
        contradictions_written: number;
      }>(`/api/transactions/replay-all`, { method: "POST" }),
  },

  alerts: {
    list: (
      params: {
        jurisdiction?: Jurisdiction;
        status?: AlertStatus;
        limit?: number;
        offset?: number;
      } = {},
    ) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) q.set(k, String(v));
      }
      return request<AlertsResponse>(`/api/alerts?${q.toString()}`);
    },
  },

  modelCard: () => request<ModelCard>("/api/model-card"),

  contradictions: {
    list: (
      params: {
        status?: "pending" | "resolved";
        limit?: number;
        offset?: number;
      } = {},
    ) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) q.set(k, String(v));
      }
      return request<ContradictionsResponse>(
        `/api/contradictions?${q.toString()}`,
      );
    },
  },
};
