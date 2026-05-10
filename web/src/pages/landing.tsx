import { ArrowRight, AlertTriangle, GitCompare, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Landing page — deliberately spends as much time on what the tool does NOT
 * do as on what it does. Per Task 2 §1's commitment to honesty.
 */
export function LandingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Strait Compliance — Jurisdiction-Aware AML Monitor
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          A working prototype that detects financial-crime typologies in
          cross-border USD/SGD corridors and applies <em>different</em>{" "}
          regulatory rules depending on whether the United States or Singapore
          is in scope. Built for the NTU MH6822 Regulatory Technology
          assignment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What the tool does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-300">
          <p>
            For every transaction, determines which AML regimes are in scope
            (US via OFAC's USD-clearing reach, Singapore via party domicile),
            loads the corresponding rule pack, applies threshold / sanctions /
            PEP / ML rules, and surfaces contradictions when the two regimes
            produce different verdicts.
          </p>
          <p>
            Uses a LightGBM scorer with TreeSHAP attributions for
            explainability, the auto-tuned decision threshold, and a
            content-hashed rule pack so every alert is traceable to the exact
            policy version in force at scoring time.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the tool does NOT do</CardTitle>
          <CardDescription>
            Honest scope, rather than performing virtue. Pulled from the Task 2
            values audit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-300">
          <ul className="space-y-2 list-disc pl-5">
            <li>
              <strong>No KYC onboarding.</strong> The tool assumes upstream
              identity verification has happened. We integrate with the data,
              not the document workflow.
            </li>
            <li>
              <strong>No GenAI / LLM components.</strong> OCC Bulletin 2026-13
              explicitly excludes them from prudential MRM. Using one would
              push the tool outside any governance frame.
            </li>
            <li>
              <strong>No automated SAR/STR narrative drafting.</strong> The
              regulator-facing narrative is the evidentiary entry point. We
              scaffold the structured fields; humans author the prose.
            </li>
            <li>
              <strong>No EU 6AMLD or UK MLR coverage.</strong> The team has
              not validated for those regimes. Marketing one without validation
              would mislead clients.
            </li>
            <li>
              <strong>No sanctions feed maintenance.</strong> We consume OFAC
              SDN and MAS TFS snapshots; we don't curate them.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where to start</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Link
            to="/dashboard"
            className="group flex flex-col gap-2 rounded-md border border-slate-800 p-3 transition-colors hover:border-orange-500/50 hover:bg-slate-900"
          >
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <div className="text-sm font-medium">Dashboard</div>
            <div className="text-xs text-slate-400">
              Alert volume, model status, regime markers
            </div>
            <ArrowRight className="ml-auto h-3 w-3 text-slate-600 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/contradictions"
            className="group flex flex-col gap-2 rounded-md border border-slate-800 p-3 transition-colors hover:border-orange-500/50 hover:bg-slate-900"
          >
            <GitCompare className="h-5 w-5 text-orange-500" />
            <div className="text-sm font-medium">Contradictions</div>
            <div className="text-xs text-slate-400">
              Transactions where US and SG verdicts diverge
            </div>
            <ArrowRight className="ml-auto h-3 w-3 text-slate-600 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/jurisdiction-config"
            className="group flex flex-col gap-2 rounded-md border border-slate-800 p-3 transition-colors hover:border-orange-500/50 hover:bg-slate-900"
          >
            <ScrollText className="h-5 w-5 text-orange-500" />
            <div className="text-sm font-medium">Rule packs</div>
            <div className="text-xs text-slate-400">
              The exact YAML that governs every alert
            </div>
            <ArrowRight className="ml-auto h-3 w-3 text-slate-600 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
