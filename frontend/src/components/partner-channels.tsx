"use client";

import Link from "next/link";
import { useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { PeriodPicker, inPeriod, usePeriod } from "@/components/period-picker";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth } from "@/lib/finance";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { PartnerDetail } from "@/lib/types";

/** Exact amounts (2 decimals), to check against the CMS's sheet. */
function exact(amount: number | string | null | undefined, currency: string) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const pctText = (v: string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

/**
 * A partner's channels: what each earned, the CMS fee, Taggify's own commission on top of it
 * (set here by the owner, for all channels or per channel, from a month on) and their share.
 */
export function PartnerChannels({ data, onChanged }: { data: PartnerDetail; onChanged: (message: string) => void }) {
  const p = data.partner;
  const base = data.base_currency;
  const period = usePeriod("all");
  const [from, setFrom] = useState(thisMonth());
  const [allPct, setAllPct] = useState(pctText(p.commission_pct));
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.channels.map((c) => [c.id, pctText(c.commission_pct)])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(channelId: string | null, value: string) {
    setBusy(channelId ?? "all");
    setError(null);
    try {
      await api(`/partners/${p.id}/commission`, {
        method: "PUT",
        json: { channel_id: channelId, pct: value === "" ? null : value, month: from },
      });
      const name = channelId ? data.channels.find((c) => c.id === channelId)?.name : `all of ${p.name}'s channels`;
      onChanged(
        value === ""
          ? `${name}: back to ${p.name}'s rate from ${formatMonth(from)}.`
          : `Taggify ${Number(value)}% on ${name} from ${formatMonth(from)}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  const lines = data.channel_months.filter((x) => inPeriod(x.month, period));
  const counts = new Map<string, number>();
  lines.forEach((x) => counts.set(x.currency, (counts.get(x.currency) ?? 0) + 1));
  const cur = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const rows = data.channels.map((c) => {
    const mine = lines.filter((x) => x.channel_id === c.id && x.currency === cur);
    const add = (pick: (x: (typeof mine)[number]) => string | null) => mine.reduce((t, x) => t + Number(pick(x) ?? 0), 0);
    return {
      channel: c,
      months: mine.length,
      estimated: mine.some((x) => x.source === "slabs"),
      unknown: mine.some((x) => x.share === null),
      // No USD→INR rate for one of its months: its INR amounts cannot be worked out.
      noRate: mine.some((x) => x.share !== null && x.share_base === null),
      gross: add((x) => x.gross),
      tax: add((x) => x.tax),
      fee: add((x) => x.cms_fee),
      commission: add((x) => x.commission),
      share: add((x) => x.share),
      commissionBase: add((x) => x.commission_base),
      shareBase: add((x) => x.share_base),
    };
  });
  rows.sort((a, b) => b.gross - a.gross);
  const total = (k: "gross" | "tax" | "fee" | "commission" | "share" | "commissionBase" | "shareBase") => rows.reduce((t, r) => t + r[k], 0);
  const history = data.commissions;
  const noRate = rows.some((r) => r.noRate);
  const rateMonths = [...new Set(lines.filter((x) => x.share !== null && x.share_base === null).map((x) => x.month))].sort();
  const inBase = (v: number) => (noRate ? "—" : exact(v, base));

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold">Taggify&apos;s commission on {p.name}&apos;s channels</h3>
          <p className="text-sm text-muted-foreground">
            Taken on top of the CMS fee, on the same amount the CMS charges on — e.g. CMS 10% + Taggify 5% = 15% off their earnings. Nothing is taken
            until you set it. A channel&apos;s own % (in the table below) wins over this one. Months before &quot;Applies from&quot; keep what they had.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="pc-all">For all their channels (%)</Label>
            <Input
              id="pc-all"
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-32"
              placeholder="Not set"
              value={allPct}
              onChange={(e) => setAllPct(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pc-from">Applies from</Label>
            <Input id="pc-from" type="month" className="w-44" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <Button onClick={() => save(null, allPct)} disabled={busy !== null || allPct === "" || allPct === pctText(p.commission_pct)}>
            {busy === "all" ? "Saving…" : "Save"}
          </Button>
          <span className="text-sm text-muted-foreground">
            Now: {p.commission_pct === null ? "not set" : `${Number(p.commission_pct)}%`}
          </span>
        </div>
        {history.length > 0 && (
          <p className="text-xs text-muted-foreground">
            History:{" "}
            {history
              .map((h) => `${h.channel_name ?? "all channels"} ${Number(h.pct)}% from ${formatMonth(h.effective_from)}`)
              .join(" · ")}
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h3 className="text-lg font-semibold">What each channel earned</h3>
            <p className="text-sm text-muted-foreground">
              CMS fee from the CMS&apos;s sheet when uploaded (else from its slabs, marked est.). Change a channel&apos;s % in its row, then Save.
            </p>
          </div>
          <PeriodPicker state={period} />
        </div>

        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Their channels earned", exact(total("gross"), cur), "Gross, before tax and fees"],
            ["CMS fee", exact(total("fee"), cur), ""],
            ["We earned from them", exact(total("commission"), cur), noRate ? `In ${base}: add the rate` : inBase(total("commissionBase"))],
            [`${p.name}'s share`, exact(total("share"), cur), noRate ? `In ${base}: add the rate` : inBase(total("shareBase"))],
          ].map(([k, v, hint]) => (
            <div key={k} className="rounded-xl bg-muted/60 p-4">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{v}</p>
              {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </div>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">US tax</TableHead>
              <TableHead className="text-right">CMS fee</TableHead>
              <TableHead className="w-44">Taggify %</TableHead>
              <TableHead className="text-right">We earned</TableHead>
              <TableHead className="text-right">Their share</TableHead>
              <TableHead className="text-right">Their share ({base})</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const c = r.channel;
              const saved = pctText(c.commission_pct);
              const value = own[c.id] ?? "";
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/channels/${c.id}`} className="font-medium hover:text-primary">
                      {c.name}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                      {c.cms_name ?? "No CMS"}
                      {r.months > 0 && ` · ${r.months} month${r.months === 1 ? "" : "s"}`}
                      {r.estimated && <span className="font-semibold text-amber-700 dark:text-amber-400">est.</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.months ? exact(r.gross, cur) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.months ? exact(r.tax, cur) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.months && !r.unknown ? exact(r.fee, cur) : "—"}</TableCell>
                  <TableCell>
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save(c.id, value);
                      }}
                    >
                      <Input
                        aria-label={`Taggify % on ${c.name}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className="h-8 w-20"
                        placeholder={p.commission_pct === null ? "—" : `${Number(p.commission_pct)}`}
                        value={value}
                        onChange={(e) => setOwn({ ...own, [c.id]: e.target.value })}
                      />
                      {value !== saved && (
                        <Button type="submit" size="sm" className="h-8 px-2" disabled={busy !== null}>
                          {busy === c.id ? "…" : "Save"}
                        </Button>
                      )}
                    </form>
                    {value === "" && (
                      <span className="text-[11px] text-muted-foreground">
                        {p.commission_pct === null ? "not set" : `${p.name}'s ${Number(p.commission_pct)}%`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {r.months && !r.unknown ? exact(r.commission, cur) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.months && !r.unknown ? exact(r.share, cur) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.months && !r.unknown && !r.noRate ? exact(r.shareBase, base) : "—"}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <EmptyRow colSpan={8}>No channels marked as {p.name}&apos;s yet — use Import channels above.</EmptyRow>}
          </TableBody>
          {rows.length > 1 && (
            <tfoot>
              <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                <TableCell>Total · {period.label}</TableCell>
                <TableCell className="text-right tabular-nums">{exact(total("gross"), cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{exact(total("tax"), cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{exact(total("fee"), cur)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{exact(total("commission"), cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{exact(total("share"), cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{inBase(total("shareBase"))}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
        {noRate && (
          <p className="border-t bg-amber-50 px-5 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            No USD→{base} rate for {rateMonths.map((m) => formatMonth(m)).join(", ")} yet, so {base} amounts show as —. Add it in{" "}
            <Link href="/finance/fx" className="font-semibold underline">
              CMS &amp; Finance → FX rates
            </Link>
            .
          </p>
        )}
        {counts.size > 1 && (
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">Totals are in {cur}; months in another currency are not added in.</p>
        )}
      </section>
    </div>
  );
}
