"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { InlineLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { PeriodPicker, periodQuery, usePeriod } from "@/components/period-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr, money } from "@/lib/finance";
import type { PartnerLeaderboard } from "@/lib/types";

/** Dashboard: which deal partners — and which of their channels — earn Taggify the most. */
export function DashboardPartners() {
  const period = usePeriod("12");
  const [data, setData] = useState<PartnerLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = periodQuery(period);

  useEffect(() => {
    setData(null);
    setError(null);
    api<PartnerLeaderboard>(`/partners/leaderboard${query}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [query]);

  const fmt = (v: string | number) => (data?.base_currency === "INR" ? compactInr(String(v)) : money(v, data?.base_currency));
  const best = data ? Math.max(1, ...data.partners.map((p) => Number(p.commission))) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Deal partners</h2>
          <p className="text-sm text-muted-foreground">What partners&apos; channels earned, and what Taggify earned from them (its commission) — {period.label}.</p>
        </div>
        <PeriodPicker state={period} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!data && !error && <InlineLoader />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["We earned from partners", fmt(data.commission), "Our commission on their channels"],
              ["Their channels earned", fmt(data.gross), "Gross, all partners"],
              ["Partners' share", fmt(data.share), "After the CMS fee and our commission"],
            ].map(([k, v, hint], i) => (
              <div
                key={k}
                className={
                  i === 0
                    ? "rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                    : "rounded-2xl border bg-card p-5 shadow-sm"
                }
              >
                <p className="text-sm text-muted-foreground">{k}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{v}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
          {data.missing > 0 && (
            <Notice kind="warning">
              {data.missing} channel-month{data.missing === 1 ? " is" : "s are"} left out: no exchange rate or CMS slabs for that month yet.
            </Notice>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="p-5 pb-3">
                <h3 className="text-lg font-semibold">Top partners</h3>
                <p className="text-sm text-muted-foreground">By what we earned from them.</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">Channels</TableHead>
                    <TableHead className="text-right">They earned</TableHead>
                    <TableHead className="text-right">We earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.partners.map((p, i) => (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <Link href={`/partners/${p.id}?tab=channels`} className="font-semibold hover:text-primary">
                          {p.name}
                        </Link>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-emerald-500/70" style={{ width: `${(Number(p.commission) / best) * 100}%` }} />
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.earning_channels}
                        <span className="text-muted-foreground"> / {p.channels}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(p.gross)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(p.commission)}</TableCell>
                    </TableRow>
                  ))}
                  {data.partners.length === 0 && <EmptyRow colSpan={5}>No deal partners with channels yet.</EmptyRow>}
                </TableBody>
              </Table>
            </section>

            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="p-5 pb-3">
                <h3 className="text-lg font-semibold">Partner channels earning us the most</h3>
                <p className="text-sm text-muted-foreground">Top 10, by our commission.</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">We earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.top_channels.map((c, i) => (
                    <TableRow key={c.channel_id}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <Link href={`/channels/${c.channel_id}`} className="font-medium hover:text-primary">
                          {c.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{c.partner_name}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(c.gross)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(c.commission)}</TableCell>
                    </TableRow>
                  ))}
                  {data.top_channels.length === 0 && <EmptyRow colSpan={4}>No partner channel earned in this period.</EmptyRow>}
                </TableBody>
              </Table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
