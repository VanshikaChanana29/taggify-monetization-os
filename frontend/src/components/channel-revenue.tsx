"use client";

import { Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/notice";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth } from "@/lib/finance";
import { cn } from "@/lib/utils";

type RevenueMonth = {
  month: string; // YYYY-MM-01
  cms_id: string | null;
  cms_name: string | null;
  currency: string;
  gross: string;
  tax: string;
  fee: string | null;
  net: string | null;
  source: "sheet" | "slabs" | null;
  fx_rate: string | null;
  net_base: string | null;
  views: number | null;
};
type RevenueOut = { base_currency: string; months: RevenueMonth[] };

type Period = "all" | "year" | "12" | "6" | "3" | "custom";
const PERIODS: Record<Period, string> = {
  all: "All time",
  year: "This year",
  "12": "Last 12 months",
  "6": "Last 6 months",
  "3": "Last 3 months",
  custom: "Choose months…",
};

/** Exact amounts (2 decimals) — this table is for checking the CMS's numbers to the cent. */
function exact(amount: string | number | null | undefined, currency: string) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function monthsAgo(n: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (n - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** One channel's money, month by month: gross → US tax → CMS fee → what the CMS pays. */
export function ChannelRevenue({ channelId }: { channelId: string }) {
  const [data, setData] = useState<RevenueOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    api<RevenueOut>(`/channels/${channelId}/revenue`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [channelId]);

  const rows = useMemo(() => {
    if (!data) return [];
    const [start, end] =
      period === "all"
        ? ["", ""]
        : period === "year"
          ? [`${new Date().getFullYear()}-01`, ""]
          : period === "custom"
            ? [from, to]
            : [monthsAgo(Number(period)), ""];
    return data.months.filter((m) => {
      const ym = m.month.slice(0, 7);
      return (!start || ym >= start) && (!end || ym <= end);
    });
  }, [data, period, from, to]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return null;

  // Totals in the currency most months are in (normally USD); others are listed but not added in.
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1));
  const cur = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const same = rows.filter((r) => r.currency === cur);
  const sum = (pick: (r: RevenueMonth) => string | null) => same.reduce((t, r) => t + Number(pick(r) ?? 0), 0);
  const feeKnown = same.every((r) => r.fee !== null);
  const baseKnown = same.every((r) => r.net_base !== null);
  const base = data.base_currency;
  const totals = {
    gross: sum((r) => r.gross),
    tax: sum((r) => r.tax),
    fee: feeKnown ? sum((r) => r.fee) : null,
    net: feeKnown ? sum((r) => r.net) : null,
    netBase: baseKnown ? sum((r) => r.net_base) : null,
  };
  const pct = (part: number | null) => (part === null || !totals.gross ? "" : `${((part / totals.gross) * 100).toFixed(1)}% of gross`);
  const estimated = rows.some((r) => r.source === "slabs");

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Wallet className="h-5 w-5 text-primary" /> Revenue, month by month
          </h3>
          <p className="text-sm text-muted-foreground">What the channel earned, the US tax and CMS fee taken off, and what the CMS pays for it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Period" className="w-44" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIODS[p]}
              </option>
            ))}
          </NativeSelect>
          {period === "custom" && (
            <>
              <Input aria-label="From month" type="month" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-sm text-muted-foreground">to</span>
              <Input aria-label="To month" type="month" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
        </div>
      </div>

      {data.months.length === 0 ? (
        <p className="border-t px-6 py-10 text-center text-sm text-muted-foreground">
          No revenue yet. It appears here once the CMS sheet (or a revenue import) for a month is uploaded.
        </p>
      ) : (
        <>
          <div className="grid gap-3 px-6 pb-5 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Gross", exact(totals.gross, cur), `${same.length} month${same.length === 1 ? "" : "s"}`],
              ["US tax", exact(totals.tax, cur), pct(totals.tax)],
              ["CMS fee", exact(totals.fee, cur), pct(totals.fee)],
              ["CMS pays", exact(totals.net, cur), pct(totals.net)],
              [`CMS pays in ${base}`, exact(totals.netBase, base), totals.netBase === null && feeKnown ? "Add the months' rates" : "At your monthly rates"],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-xl bg-muted/60 p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
                {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
              </div>
            ))}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>CMS</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">US tax</TableHead>
                <TableHead className="text-right">CMS fee</TableHead>
                <TableHead className="text-right">CMS pays</TableHead>
                <TableHead className="text-right">In {base}</TableHead>
                <TableHead className="text-right">Views</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.month}-${r.cms_id}-${r.currency}`} className={cn(r.currency !== cur && "text-muted-foreground")}>
                  <TableCell className="whitespace-nowrap font-medium">{formatMonth(r.month.slice(0, 7))}</TableCell>
                  <TableCell>
                    {r.cms_name ?? "No CMS"}
                    {r.source === "slabs" && r.cms_id && (
                      <span
                        className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        title="No CMS sheet for this month: fee worked out from the CMS's slabs"
                      >
                        est.
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{exact(r.gross, r.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(r.tax, r.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(r.fee, r.currency)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{exact(r.net, r.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(r.net_base, base)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.views?.toLocaleString("en-IN") ?? "—"}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No revenue in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {rows.length > 1 && (
              <tfoot>
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{exact(totals.gross, cur)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(totals.tax, cur)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(totals.fee, cur)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(totals.net, cur)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(totals.netBase, base)}</TableCell>
                  <TableCell />
                </TableRow>
              </tfoot>
            )}
          </Table>
          {(estimated || counts.size > 1) && (
            <p className="border-t px-6 py-3 text-xs text-muted-foreground">
              {estimated && "est. = no CMS sheet for that month yet, so the fee is worked out from the CMS's slabs. "}
              {counts.size > 1 && `Totals are in ${cur}; greyed months are in another currency and not added in.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
