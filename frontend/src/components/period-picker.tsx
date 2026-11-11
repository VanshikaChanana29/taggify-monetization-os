"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type Period = "all" | "month" | "year" | "12" | "6" | "3" | "custom";

const PERIODS: Record<Period, string> = {
  all: "All time",
  month: "This month",
  year: "This year",
  "12": "Last 12 months",
  "6": "Last 6 months",
  "3": "Last 3 months",
  custom: "Choose months…",
};

function monthsAgo(n: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (n - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A period of whole months: { from, to } as YYYY-MM, empty = open-ended. */
export function usePeriod(initial: Period = "all") {
  const [period, setPeriod] = useState<Period>(initial);
  const [customFrom, setFrom] = useState("");
  const [customTo, setTo] = useState("");
  const range = useMemo(() => {
    switch (period) {
      case "all":
        return { from: "", to: "" };
      case "month":
        return { from: monthsAgo(1), to: "" };
      case "year":
        return { from: `${new Date().getFullYear()}-01`, to: "" };
      case "custom":
        return { from: customFrom, to: customTo };
      default:
        return { from: monthsAgo(Number(period)), to: "" };
    }
  }, [period, customFrom, customTo]);
  const label = period === "custom" ? [customFrom, customTo].filter(Boolean).join(" → ") || "Chosen months" : PERIODS[period];
  return { period, setPeriod, customFrom, setFrom, customTo, setTo, ...range, label };
}

export type PeriodState = ReturnType<typeof usePeriod>;

/** Is a YYYY-MM (or YYYY-MM-DD) month inside the period? */
export function inPeriod(month: string, p: { from: string; to: string }) {
  const ym = month.slice(0, 7);
  return (!p.from || ym >= p.from) && (!p.to || ym <= p.to);
}

/** Query string for the API: from=YYYY-MM&to=YYYY-MM (only what is set). */
export function periodQuery(p: { from: string; to: string }) {
  const q = new URLSearchParams();
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function PeriodPicker({ state }: { state: PeriodState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Period" className="w-44" value={state.period} onChange={(e) => state.setPeriod(e.target.value as Period)}>
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <option key={p} value={p}>
            {PERIODS[p]}
          </option>
        ))}
      </NativeSelect>
      {state.period === "custom" && (
        <>
          <Input aria-label="From month" type="month" className="w-40" value={state.customFrom} onChange={(e) => state.setFrom(e.target.value)} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input aria-label="To month" type="month" className="w-40" value={state.customTo} onChange={(e) => state.setTo(e.target.value)} />
        </>
      )}
    </div>
  );
}
