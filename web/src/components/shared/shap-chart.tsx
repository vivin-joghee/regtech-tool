/**
 * Horizontal bar chart of SHAP feature attributions.
 *
 * Positive contributions push the model toward 'suspicious'; negative
 * contributions push toward 'benign'. Coloring matches the verdict palette
 * so a reviewer's eye reads it the same way as the rest of the UI.
 */

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ShapChartProps {
  /** Map from feature name to SHAP value. */
  values: Record<string, number>;
  /** How many features to show (top by |SHAP|). Defaults to 12. */
  topN?: number;
  /** Chart height in pixels. Defaults to 360. */
  height?: number;
  /** If true, take absolute values (used for global importance views). */
  absolute?: boolean;
}

const POSITIVE_COLOR = "oklch(0.62 0.20 25)"; // matches block (red)
const NEGATIVE_COLOR = "oklch(0.70 0.13 145)"; // matches allow (green)
const NEUTRAL_COLOR = "oklch(0.55 0.02 250)"; // muted slate

export function ShapChart({
  values,
  topN = 12,
  height = 360,
  absolute = false,
}: ShapChartProps) {
  const sorted = Object.entries(values)
    .map(([feature, value]) => ({
      feature,
      value: absolute ? Math.abs(value) : value,
      raw: value,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, topN)
    .reverse(); // recharts horizontal bars stack bottom-up; reverse so largest is at top

  if (sorted.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic py-4">
        No SHAP attributions available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "oklch(0.55 0.02 250)" }}
          stroke="oklch(0.30 0.02 250)"
        />
        <YAxis
          type="category"
          dataKey="feature"
          width={170}
          tick={{ fontSize: 10, fill: "oklch(0.75 0.02 250)" }}
          stroke="oklch(0.30 0.02 250)"
        />
        <Tooltip
          cursor={{ fill: "oklch(0.20 0.02 250 / 0.5)" }}
          contentStyle={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.30 0.02 250)",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "oklch(0.85 0.01 250)" }}
          formatter={(v: number, _name, p) => [
            absolute
              ? v.toFixed(4)
              : `${v >= 0 ? "+" : ""}${v.toFixed(4)} (${
                  v >= 0 ? "→ suspicious" : "→ benign"
                })`,
            p.payload.feature,
          ]}
        />
        <Bar dataKey="value">
          {sorted.map((d, i) => {
            const color = absolute
              ? NEUTRAL_COLOR
              : d.value > 0
                ? POSITIVE_COLOR
                : NEGATIVE_COLOR;
            return <Cell key={i} fill={color} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
