"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { InlineLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { PeriodPicker, periodQuery, usePeriod } from "@/components/period-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { money } from "@/lib/finance";
import type { Deal, DealEarnings as Earnings } from "@/lib/types";

/** Everything the deal's channels earned Taggify: its own channels, plus its commission on
 * partners' channels — channel by channel, for the months they held the deal's slots. */
export function DealEarnings({ deal }: { deal: Deal }) {
  const period = usePeriod("all");
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = periodQuery(period);

  useEffect(() => {
    setData(null);
    setError(null);
    api<Earnings>(`/deals/${deal.id}/earnings${query}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [deal.id, query]);

  const base = data?.base_currency ?? "INR";
  const total = data ? Number(data.own) + Number(data.commission) : 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">What this deal earned us</h3>
          <p className="text-sm text-muted-foreground">
            Our own channels after the CMS fee, plus our commission on partners&apos; channels — for the months each channel held this deal&apos;s
            slots. In {base} at your monthly rates.
          </p>
        </div>
        <PeriodPicker state={period} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!data && !error && <InlineLoader />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["From our own channels", money(data.own, base), "After the CMS fee"],
              ["Our commission on partners", money(data.commission, base), `Partners kept ${money(data.partners_share, base)}`],
              ["We earned in all", money(total, base), period.label],
              [
                "Our part of the licence fee",
                data.licence_cost === null ? "—" : money(data.licence_cost, base),
                data.licence_cost === null ? "No fixed fee" : `${Math.round((total / Math.max(1, Number(data.licence_cost))) * 100)}% earned back`,
              ],
            ].map(([k, v, hint], i) => (
              <div
                key={k}
                className={
                  i === 2
                    ? "rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                    : "rounded-2xl border bg-card p-4 shadow-sm"
                }
              >
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{v}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
          {data.missing > 0 && (
            <Notice kind="warning">
              {data.missing} channel-month{data.missing === 1 ? " is" : "s are"} left out: no exchange rate or CMS slabs for that month yet.
            </Notice>
          )}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Whose</TableHead>
                  <TableHead className="text-right">Months</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">CMS fee</TableHead>
                  <TableHead className="text-right">Partner kept</TableHead>
                  <TableHead className="text-right">We earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.channels.map((c) => (
                  <TableRow key={c.channel_id}>
                    <TableCell>
                      <Link href={`/channels/${c.channel_id}`} className="font-medium hover:text-primary">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className={c.partner_name ? "" : "text-muted-foreground"}>{c.partner_name ?? "Taggify"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.months}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.gross, base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.cms_fee, base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.partner_name ? money(c.partner, base) : "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(c.taggify, base)}</TableCell>
                  </TableRow>
                ))}
                {data.channels.length === 0 && <EmptyRow colSpan={7}>No revenue yet for channels in this deal&apos;s slots.</EmptyRow>}
              </TableBody>
              {data.channels.length > 1 && (
                <tfoot>
                  <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{money(data.gross, base)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{money(data.partners_share, base)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{money(total, base)}</TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
