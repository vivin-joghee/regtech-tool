import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";

import { Nav } from "@/components/layout/nav";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export function Shell() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 60_000,
  });

  return (
    <div className="grid h-screen grid-cols-[260px_1fr] grid-rows-[auto_1fr]">
      {/* Top bar */}
      <header className="col-span-2 flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            Strait Compliance
          </span>
          <span className="text-xs text-slate-500">
            Jurisdiction-Aware AML Monitor · prototype
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {health.data ? (
            <>
              <Badge variant="outline" className="font-mono">
                US pack {health.data.rule_packs.US.sha}
              </Badge>
              <Badge variant="outline" className="font-mono">
                SG pack {health.data.rule_packs.SG.sha}
              </Badge>
              <Badge variant="info" className="font-mono">
                model {health.data.model.model_sha256.slice(0, 8)}
              </Badge>
            </>
          ) : health.isError ? (
            <Badge variant="block">API offline</Badge>
          ) : (
            <Badge variant="muted">connecting…</Badge>
          )}
        </div>
      </header>

      {/* Side nav */}
      <aside className="border-r border-slate-800 bg-slate-950/40">
        <Nav />
      </aside>

      {/* Page content */}
      <main className="overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
