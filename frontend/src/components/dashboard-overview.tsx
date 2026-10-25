"use client";

import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Handshake, Info, Landmark } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { TopChannels } from "@/components/dashboard-channels";
import { hasFxGap, stages, Track } from "@/components/finance/lifecycle";
import { Pill } from "@/components/pill";
import { TrendChart } from "@/components/trend-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES } from "@/lib/deals";
import { compactInr, formatMonth, money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import type { AgingBucket, AttentionItem, CloseStatus, CmsMonth, Dashboard, DashboardChannels, FinanceMonth } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEVERITY = {
  danger: { icon: AlertOctagon, dot: "bg-red-500", className: "text-red-600 dark:text-red-400", label: "Urgent", rank: 0 },
  warning: { icon: AlertTriangle, dot: "bg-amber-500", className: "text-amber-600 dark:text-amber-400", label: "Soon", rank: 1 },
  info: { icon: Info, dot: "bg-sky-500", className: "text-sky-600 dark:text-sky-400", label: "To do", rank: 2 },
} as const;

const AGING: [AgingBucket, string][] = [
  ["d0_30", "0–30 days"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
];

const compactNum = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Card({ title, sub, action, className, children }: { title: string; sub?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card p-6 shadow-sm", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AllLink({ href, children = "Open" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
      {children} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

// ---- 1. The month in one sentence ---------------------------------------------------------------

function Story({
  month,
  earned,
  owes,
  received,
  pending,
  todo,
  yt,
}: {
  month: string;
  earned: string;
  owes: string;
  received: string;
  pending: string | null;
  todo: number;
  yt: DashboardChannels | null;
}) {
  const change = yt?.revenue_change_pct == null ? null : Number(yt.revenue_change_pct);
  const facts: [string, string][] = [
    ["Channels earning", yt ? `${yt.channels_with_revenue}` : "—"],
    ["Views", yt ? compactNum(yt.views) : "—"],
    ["RPM", yt?.rpm ? money(yt.rpm, "USD") : "—"],
  ];
  return (
    <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-orange-50 via-card to-sky-50 p-6 shadow-sm dark:from-orange-500/10 dark:via-card dark:to-sky-500/10 sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">{formatMonth(month)} at a glance</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-4xl font-bold tracking-tight sm:text-5xl">{earned}</span>
            <span className="text-lg text-muted-foreground">earned</span>
            {change !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-sm font-semibold",
                  change >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
                )}
                title={yt ? `Compared with the ${yt.previous_revenue ? "same number of days just before" : "period before"}` : undefined}
              >
                {change >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                {Math.abs(change).toFixed(1)}%
              </span>
            )}
          </p>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">
            CMS partners owe us <b className="text-foreground">{owes}</b> for this month. <b className="text-emerald-700 dark:text-emerald-400">{received}</b> has reached the bank
            {pending ? (
              <>
                , <b className="text-amber-700 dark:text-amber-400">{pending}</b> is still to come
              </>
            ) : null}
            .{" "}
            {todo > 0 ? (
              <>
                <b className="text-foreground">
                  {todo} thing{todo === 1 ? "" : "s"}
                </b>{" "}
                need you.
              </>
            ) : (
              "Nothing needs you right now."
            )}
          </p>
          {yt?.last_sync && <p className="mt-2 text-xs text-muted-foreground">YouTube estimates until the CMS sheet arrives · last sync {formatDateTime(yt.last_sync)}</p>}
        </div>
        <dl className="grid grid-cols-3 gap-3 lg:w-[22rem]">
          {facts.map(([k, v]) => (
            <Link key={k} href={`/?tab=channels&month=${month}`} className="rounded-2xl border bg-card/80 p-3 text-center backdrop-blur transition-colors hover:border-primary/50">
              <dd className="text-xl font-bold tabular-nums">{v}</dd>
              <dt className="text-xs text-muted-foreground">{k}</dt>
            </Link>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ---- 2. Where the money is, as one strip --------------------------------------------------------

type Seg = { label: string; value: number; text: string; color: string; href: string };

function Strip({ segs, total, offset = 0 }: { segs: Seg[]; total: number; offset?: number }) {
  return (
    <div className="flex h-11 w-full gap-[2px]" style={{ paddingLeft: `${(offset / total) * 100}%` }}>
      {segs
        .filter((s) => s.value > 0)
        .map((s) => (
          <Link
            key={s.label}
            href={s.href}
            title={`${s.label}: ${s.text}`}
            className="group flex min-w-[2.75rem] items-center overflow-hidden rounded-lg px-3 text-xs font-semibold text-white transition-opacity hover:opacity-85"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          >
            <span className="truncate">
              {s.label} · {s.text}
            </span>
          </Link>
        ))}
    </div>
  );
}

function MoneyJourney({ month, rows, data }: { month: string; rows: CmsMonth[]; data: Dashboard }) {
  const m = `month=${month}`;
  const cms = rows.filter((r) => r.cms_id);
  const fxGap = cms.some(hasFxGap);
  const currencies = [...new Set(cms.map((r) => r.currency))];
  const base = data.base_currency;
  const sum = (f: (r: CmsMonth) => string | null) => cms.reduce((s, r) => s + Number(f(r) ?? 0), 0);

  // With this month's rate everything is in rupees; without it, show the CMS's own currency.
  const useBase = !fxGap || currencies.length !== 1;
  const cur = useBase ? base : (currencies[0] ?? "USD");
  const fmt = (v: number) => (cur === "INR" ? compactInr(v) : money(v, cur));
  const earned = useBase ? Number(data.current.gross) : sum((r) => r.gross);
  const fee = useBase ? Number(data.current.fee) : sum((r) => r.fee);
  const owes = useBase ? Number(data.current.net) : sum((r) => r.net);
  const tax = Math.max(0, earned - fee - owes);
  const received = Number(data.current.received);
  const pending = Math.max(0, Number(data.current.outstanding));

  if (earned <= 0)
    return (
      <Card title="Where the money is" sub={formatMonth(month)} className="lg:col-span-3">
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No earnings for {formatMonth(month)} yet.</p>
      </Card>
    );

  const rowsOut: { label: string; hint: string; segs: Seg[]; offset?: number }[] = [
    { label: "Earned", hint: "What the channels made", segs: [{ label: "Earned", value: earned, text: fmt(earned), color: "var(--series-1)", href: `/finance/revenue?${m}` }] },
    {
      label: "Split",
      hint: "What the CMS keeps, and what it owes us",
      segs: [
        { label: "CMS fee", value: fee, text: fmt(fee), color: "var(--series-other)", href: `/finance?${m}&step=setup` },
        { label: "Tax", value: tax, text: fmt(tax), color: "var(--series-other)", href: `/finance?${m}` },
        { label: "Owes us", value: owes, text: fmt(owes), color: "var(--series-2)", href: `/finance?${m}&step=sheet` },
      ],
    },
  ];
  if (!fxGap)
    rowsOut.push({
      label: "Collected",
      hint: "Of what they owe: in the bank, and still to come",
      offset: earned - owes,
      segs: [
        { label: "In the bank", value: received, text: fmt(received), color: "#059669", href: `/finance?${m}&step=paid` },
        { label: "Still to come", value: pending, text: fmt(pending), color: "#d97706", href: `/finance?${m}&step=paid` },
      ],
    });

  return (
    <Card
      title="Where the money is"
      sub={`${formatMonth(month)} · all CMS partners · ${cur}`}
      action={<AllLink href={`/finance?${m}`}>Finance</AllLink>}
      className="lg:col-span-3"
    >
      <div className="space-y-4">
        {rowsOut.map((r) => (
          <div key={r.label}>
            <p className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</span>
              <span className="text-muted-foreground">{r.hint}</span>
            </p>
            <Strip segs={r.segs} total={earned} offset={r.offset} />
          </div>
        ))}
        {fxGap && (
          <Link
            href={`/finance/fx?${m}`}
            className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:underline dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Set the {cur} rate for {formatMonth(month)} to see how much has reached the bank and how much is still to come.
          </Link>
        )}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
        {[
          ["Earned", fmt(earned)],
          ["CMS fee", fmt(fee)],
          ["Owes us", fmt(owes)],
          ["Still to come", fxGap ? "Set rate" : fmt(pending)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ---- 3. What needs doing --------------------------------------------------------------------------

function DoNow({ items, fmt }: { items: AttentionItem[]; fmt: (v: string) => string }) {
  const sorted = [...items].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);
  return (
    <Card title="Do this now" sub={items.length ? "Most urgent first" : "All clear"} className="lg:col-span-2" action={items.length ? <Pill tone="border-border bg-muted text-foreground">{items.length}</Pill> : undefined}>
      {sorted.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Nothing needs you right now.
        </p>
      ) : (
        <ul className="-mx-2 space-y-1">
          {sorted.slice(0, 7).map((item) => {
            const s = SEVERITY[item.severity];
            return (
              <li key={item.key}>
                <Link href={item.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.dot)} aria-label={s.label} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  {item.amount && <p className="whitespace-nowrap text-sm font-semibold tabular-nums">{fmt(item.amount)}</p>}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
          {sorted.length > 7 && <li className="px-2 pt-1 text-xs text-muted-foreground">+{sorted.length - 7} more</li>}
        </ul>
      )}
    </Card>
  );
}

// ---- 4. Who earns it ------------------------------------------------------------------------------

function ByCms({ month, rows }: { month: string; rows: CmsMonth[] }) {
  const earning = rows.filter((r) => Number(r.gross) > 0).sort((a, b) => Number(b.gross) - Number(a.gross));
  const total = earning.reduce((s, r) => s + Number(r.gross), 0);
  return (
    <Card title="Earnings by CMS" sub={formatMonth(month)} action={<AllLink href={`/finance?month=${month}`}>All</AllLink>}>
      {earning.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No earnings yet.</p>
      ) : (
        <ul className="space-y-4">
          {earning.map((r, i) => {
            const pct = total ? (Number(r.gross) / total) * 100 : 0;
            return (
              <li key={r.cms_id ?? "none"}>
                <Link href={`/finance/${r.cms_id ?? "none"}?month=${month}`} className="group block">
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-medium group-hover:text-primary">
                      <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.cms_name}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(r.gross, r.currency)}</span>
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: `var(--series-${(i % 6) + 1})` }} />
                    </span>
                    <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {r.channel_count} channels{r.fee !== null ? ` · fee ${money(r.fee, r.currency)}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Deals({ data, fmt }: { data: Dashboard; fmt: (v: string) => string }) {
  const overall = data.recovery_pct === null ? null : Number(data.recovery_pct);
  return (
    <Card title="Deal recovery" sub={overall === null ? "Fixed-fee deals" : `${overall}% of all rights cost earned back`} action={<AllLink href="/deals">All</AllLink>}>
      {data.deals.length === 0 ? (
        <p className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <Handshake className="h-6 w-6" /> No fixed-fee deals yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {data.deals.slice(0, 4).map((d) => {
            const pct = d.recovery_pct === null ? 0 : Number(d.recovery_pct);
            return (
              <li key={d.id}>
                <Link href={`/deals/${d.id}`} className="group block">
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium group-hover:text-primary">{d.title}</span>
                    <Pill tone={DEAL_STATUS_TONES[d.status]}>{DEAL_STATUS_LABELS[d.status]}</Pill>
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    </span>
                    <span className="w-12 text-right text-xs font-semibold tabular-nums">{pct}%</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {fmt(d.net_contribution)} back of {fmt(d.rights_cost)}
                    {Number(d.payable) > 0 ? ` · ${fmt(d.payable)} still to pay the owner` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---- The page -------------------------------------------------------------------------------------

export function DashboardOverview({ data }: { data: Dashboard }) {
  const router = useRouter();
  const m = data.month;
  const cur = data.base_currency;
  const fmt = (v: string) => (cur === "INR" ? compactInr(v) : money(v, cur));
  const [fin, setFin] = useState<FinanceMonth | null>(null);
  const [close, setClose] = useState<CloseStatus | null>(null);
  const [yt, setYt] = useState<DashboardChannels | null>(null);
  // Months without an exchange rate come out as ₹0; then chart the CMS's own currency instead.
  const noRates = data.trend.every((t) => Number(t.gross) === 0);
  const [ownTrend, setOwnTrend] = useState<{ currency: string; points: Dashboard["trend"] } | null>(null);

  useEffect(() => {
    setFin(null);
    setYt(null);
    api<FinanceMonth>(`/finance/settlements?month=${m}`).then(setFin).catch(() => setFin(null));
    api<CloseStatus>(`/finance/close?month=${m}`).then(setClose).catch(() => setClose(null));
    api<DashboardChannels>(`/dashboard/channels?month=${m}`).then(setYt).catch(() => setYt(null));
  }, [m]);

  useEffect(() => {
    setOwnTrend(null);
    if (!noRates) return;
    Promise.all(data.trend.map((t) => api<FinanceMonth>(`/finance/settlements?month=${t.month.slice(0, 7)}`)))
      .then((months) => {
        const cms = months.flatMap((f) => f.rows.filter((r) => r.cms_id));
        const currencies = [...new Set(cms.map((r) => r.currency))];
        if (currencies.length !== 1 || !currencies[0]) return;
        const add = (rows: CmsMonth[], f: (r: CmsMonth) => string | null) => String(rows.reduce((s, r) => s + Number(f(r) ?? 0), 0));
        setOwnTrend({
          currency: currencies[0],
          points: data.trend.map((t, i) => {
            const rows = months[i].rows;
            return { ...t, gross: add(rows, (r) => r.gross), fee: add(rows, (r) => r.fee), net: add(rows.filter((r) => r.cms_id), (r) => r.net) };
          }),
        });
      })
      .catch(() => setOwnTrend(null));
  }, [data.trend, noRates]);

  const rows = fin?.rows ?? [];
  const cms = rows.filter((r) => r.cms_id);
  const fxGap = cms.some(hasFxGap);
  const currencies = [...new Set(cms.map((r) => r.currency))];
  const own = fxGap && currencies.length === 1 ? currencies[0] : null;
  const sum = (f: (r: CmsMonth) => string | null) => cms.reduce((s, r) => s + Number(f(r) ?? 0), 0);
  const allRows = rows.reduce((s, r) => s + Number(r.gross), 0);
  const list = fin ? stages(m, fin, close) : null;
  const items = [...data.money, ...data.operations];

  return (
    <div className="space-y-8">
      <Story
        month={m}
        earned={own ? money(allRows, own) : fmt(data.current.gross)}
        owes={own ? money(sum((r) => r.net), own) : fmt(data.current.net)}
        received={fmt(data.current.received)}
        pending={fxGap ? null : fmt(data.current.outstanding)}
        todo={items.length}
        yt={yt}
      />

      {list && (
        <Card
          title="Month lifecycle"
          sub={`${list.filter((s) => s.done).length} of ${list.length} steps done for ${formatMonth(m)} — click a step to work on it`}
          action={<AllLink href={`/finance?month=${m}`}>Finance</AllLink>}
        >
          <Track list={list} current={Math.max(0, list.findIndex((s) => !s.done))} selected={-1} onSelect={(i) => router.push(`/finance?month=${m}&step=${list[i].key}`)} />
        </Card>
      )}

      <div className="grid gap-8 lg:grid-cols-5">
        {fin ? <MoneyJourney month={m} rows={rows} data={data} /> : <div className="lg:col-span-3" />}
        <DoNow items={items} fmt={fmt} />
      </div>

      <TrendChart
        points={ownTrend?.points ?? data.trend}
        currency={ownTrend?.currency ?? cur}
        note={ownTrend ? `In ${ownTrend.currency}, as the CMS reports it — set each month's rate to see rupees and cash received.` : undefined}
        onPick={(month) => router.push(`/finance?month=${month.slice(0, 7)}`)}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <ByCms month={m} rows={rows} />
        <TopChannels rows={yt?.top ?? []} scope={yt ? `start=${yt.start}&end=${yt.end}` : `month=${m}`} />
        <Deals data={data} fmt={fmt} />
      </div>

      <div className="grid gap-8 xl:grid-cols-5">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-3">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Who owes us, and for how long</h3>
            <p className="text-sm text-muted-foreground">Still owed by each CMS, by days since the month ended (up to {formatMonth(m)}).</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CMS</TableHead>
                {AGING.map(([k, label]) => (
                  <TableHead key={k} className="text-right">
                    {label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.aging.map((a) => (
                <TableRow key={a.cms_id} className="cursor-pointer" onClick={() => router.push(`/finance/${a.cms_id}?month=${m}`)}>
                  <TableCell className="font-semibold">{a.cms_name}</TableCell>
                  {AGING.map(([k]) => (
                    <TableCell
                      key={k}
                      className={cn(
                        "text-right tabular-nums",
                        Number(a.buckets[k]) === 0 && "text-muted-foreground",
                        (k === "d61_90" || k === "d90_plus") && Number(a.buckets[k]) > 0 && "font-semibold text-red-600 dark:text-red-400",
                      )}
                    >
                      {Number(a.buckets[k]) === 0 ? "—" : fmt(a.buckets[k])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(a.total)}</TableCell>
                </TableRow>
              ))}
              {data.aging.length === 0 && <EmptyRow colSpan={6}>{fxGap ? "Set this month's rate to see what is owed." : "No CMS owes anything."}</EmptyRow>}
            </TableBody>
          </Table>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-2">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Top people</h3>
            <p className="text-sm text-muted-foreground">Who managed the most earnings in {formatMonth(m)}, and their incentive.</p>
          </div>
          <Table>
            <TableBody>
              {data.people.map((p, i) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/people/${p.id}`)}>
                  <TableCell className="w-8 text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.channels ? `${p.channels} channel${p.channels > 1 ? "s" : ""} · ${fmt(p.gross)}` : "Team lead"}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="font-semibold">{fmt(p.incentive)}</p>
                    <p className="text-xs text-muted-foreground">incentive</p>
                  </TableCell>
                </TableRow>
              ))}
              {data.people.length === 0 && <EmptyRow colSpan={3}>{fxGap ? "Set this month's rate to work out incentives." : "No incentives this month."}</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      </div>
    </div>
  );
}
