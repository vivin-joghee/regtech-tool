import {
  AlertTriangle,
  BookOpen,
  GitCompare,
  Home,
  LayoutDashboard,
  ScrollText,
  Telescope,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: Home, exact: true },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: false },
  { to: "/transactions", label: "Transactions", icon: Telescope, exact: false },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle, exact: false },
  { to: "/contradictions", label: "Contradictions", icon: GitCompare, exact: false },
  { to: "/jurisdiction-config", label: "Rule packs", icon: ScrollText, exact: false },
  { to: "/model-card", label: "Model card", icon: BookOpen, exact: false },
] as const;

export function Nav() {
  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.exact}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-slate-800 text-slate-50"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
            )
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
