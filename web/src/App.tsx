import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { Shell } from "@/components/layout/shell";
import { AlertsPage } from "@/pages/alerts";
import { ContradictionsPage } from "@/pages/contradictions";
import { DashboardPage } from "@/pages/dashboard";
import { JurisdictionConfigPage } from "@/pages/jurisdiction-config";
import { LandingPage } from "@/pages/landing";
import { ModelCardPage } from "@/pages/model-card";
import { TransactionsPage } from "@/pages/transactions";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/contradictions" element={<ContradictionsPage />} />
            <Route
              path="/jurisdiction-config"
              element={<JurisdictionConfigPage />}
            />
            <Route path="/model-card" element={<ModelCardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
