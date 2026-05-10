import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-slate-700 text-slate-100",
        outline: "border border-slate-700 text-slate-300",
        block: "bg-red-950/80 text-red-200 border border-red-800/50",
        flag: "bg-amber-950/70 text-amber-200 border border-amber-800/40",
        allow: "bg-emerald-950/60 text-emerald-200 border border-emerald-800/40",
        info: "bg-sky-950/70 text-sky-200 border border-sky-800/40",
        muted: "bg-slate-800 text-slate-400",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
