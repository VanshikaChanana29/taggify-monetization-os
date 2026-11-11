"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { formatMonth, money } from "@/lib/finance";
import type { Deal, DealEconomics } from "@/lib/types";
import { cn } from "@/lib/utils";

const WINDOWS = [3, 6, 12] as const;

/**
 * Is the deal in profit or still a loss, by how much, and — at the recent pace — when the
 * licence fee will be covered. Earned so far = own channels after the CMS fee, incentives,
 * expenses (and the owner's share) + our commission on partners' channels.
 */
export function DealProfitLoss({ deal, e, compact = false }: { deal: Deal; e: DealEconomics; compact?: boolean }) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(3);
  const cur = e.base_currency;
  const cost = e.rights_cost === null ? null : Number(e.rights_cost);
  const earned = Number(e.net_contribution);
  const profit = Number(e.profit ?? earned - (cost ?? 0));
  const inProfit = profit >= 0;
  const covered = cost ? Math.max(0, (earned / cost) * 100) : null;

  // Recent pace: the average month over the last N months that had revenue.
  const recent = e.by_month.filter((m) => Number(m.gross) > 0 || Number(m.commission) > 0).slice(-window);
  const pace = recent.length ? recent.reduce((t, m) => t + Number(m.net), 0) / recent.length : null;
  const toCover = !inProfit && pace && pace > 0 ? Math.ceil(-profit / pace) : null;
  const tooSlow = toCover !== null && toCover > e.months_left;

  const Icon = inProfit ? TrendingUp : TrendingDown;
  const tone = inProfit
    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
    : "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10";
  const textTone = inProfit ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400";

  return (
    <section className={cn("rounded-2xl border p-6 shadow-sm", tone)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{inProfit ? "In profit" : "Still a loss"}</p>
          <p className={cn("mt-1 flex items-center gap-2 text-4xl font-bold tabular-nums", textTone)}>
            <Icon className="h-8 w-8" />
            {inProfit ? "+" : "−"}
            {money(Math.abs(profit), cur)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {cost === null
              ? "No licence fee on this deal: everything earned is profit."
              : inProfit
                ? `Licence fee covered (${Math.round(covered ?? 0)}%) — everything above it is profit.`
                : `${money(-profit, cur)} still to cover · ${Math.round(covered ?? 0)}% covered so far`}
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p>
            Term {e.term_start ? formatMonth(e.term_start.slice(0, 7)) : "—"} – {e.term_end ? formatMonth(e.term_end.slice(0, 7)) : "—"}
          </p>
          <p className="font-semibold text-foreground">
            {e.months_left > 0 ? `${e.months_left} month${e.months_left === 1 ? "" : "s"} left` : "Term over"}
          </p>
        </div>
      </div>

      {cost !== null && (
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-background/70">
          <div className={cn("h-full rounded-full", inProfit ? "bg-emerald-600" : "bg-red-500")} style={{ width: `${Math.min(100, covered ?? 0)}%` }} />
        </div>
      )}

      {!compact && (
        <dl className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{deal.deal_type === "hybrid" ? "Minimum guarantee (our part)" : "Licence fee (our part)"}</dt>
            <dd className="font-semibold tabular-nums">{cost === null ? "—" : money(cost, cur)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Earned so far</dt>
            <dd className="font-semibold tabular-nums">{money(earned, cur)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">· from our own channels</dt>
            <dd className="tabular-nums">{money(earned - Number(e.partner_commission), cur)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">· our commission on partners&apos; channels</dt>
            <dd className="tabular-nums">{money(e.partner_commission, cur)}</dd>
          </div>
        </dl>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-foreground/10 pt-4 text-sm">
        <span className="text-muted-foreground">Average of the last</span>
        <NativeSelect aria-label="Months to average" className="h-8 w-20" value={window} onChange={(ev) => setWindow(Number(ev.target.value) as 3 | 6 | 12)}>
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </NativeSelect>
        <span className="text-muted-foreground">months:</span>
        {pace === null ? (
          <span>no revenue yet</span>
        ) : (
          <>
            <b className="tabular-nums">{money(pace, cur)}/month</b>
            {recent.length < window && <span className="text-muted-foreground">(only {recent.length} so far)</span>}
            {!inProfit &&
              (toCover === null ? (
                <span className="font-semibold text-red-700 dark:text-red-400">· at this pace it is not covering the fee</span>
              ) : (
                <span className={cn("font-semibold", tooSlow ? "text-red-700 dark:text-red-400" : "")}>
                  · covered in about {toCover} month{toCover === 1 ? "" : "s"}
                  {tooSlow && ` — but only ${e.months_left} left in the term`}
                </span>
              ))}
          </>
        )}
      </div>
    </section>
  );
}
