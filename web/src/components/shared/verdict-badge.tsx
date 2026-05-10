import { Badge } from "@/components/ui/badge";
import type { Verdict } from "@/lib/api";

const VARIANT: Record<Verdict, "block" | "flag" | "allow"> = {
  block: "block",
  flag: "flag",
  allow: "allow",
};

const LABEL: Record<Verdict, string> = {
  block: "BLOCK",
  flag: "FLAG",
  allow: "ALLOW",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge variant={VARIANT[verdict]}>{LABEL[verdict]}</Badge>;
}

export function JurisdictionBadge({
  jurisdiction,
}: {
  jurisdiction: "US" | "SG";
}) {
  return (
    <Badge variant="outline" className="font-mono">
      {jurisdiction}
    </Badge>
  );
}
