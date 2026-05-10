import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn-style className combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compact ISO timestamp formatter for tables. */
export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-SG", {
    year: "2-digit",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Money formatter — passes through native amounts as-is. */
export function fmtMoney(
  amount: number | string | null | undefined,
  currency?: string,
): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  const currencyCode = currency?.trim().toUpperCase() || "USD";
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Truncate UUIDs for compact display. */
export function shortId(id: string | null | undefined, len = 8): string {
  if (!id) return "—";
  return id.slice(0, len);
}
