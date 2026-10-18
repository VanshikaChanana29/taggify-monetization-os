"use client";

import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Coins,
  Info,
  Landmark,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { MonthPicker } from "@/components/month-picker";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { useOrganization, useSession } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { TrendChart } from "@/components/trend-chart";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES } from "@/lib/deals";
import { compactInr, formatMonth, money, shiftMonth } from "@/lib/finance";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { AgingBucket, AttentionItem, Dashboard, GroupDashboard } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEVERITY = {
  danger: { icon: AlertOctagon, className: "text-red-600 dark:text-red-400", label: "Urgent" },
  warning: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400", label: "Check" },
  info: { icon: Info, className: "text-sky-600 dark:text-sky-400", label: "To do" },
} as const;

const AGING: [AgingBucket, string][] = [
  ["d0_30", "0–30 days"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
];

function change(now: string, before: string, previousMonth: string) {
  const a = Number(now);
  const b = Number(before);
  if (!b) return <span>No data for {formatMonth(previousMonth)}</span>;
  const pct = ((a - b) / Math.abs(b)) * 100;
  const up = pct >= 0;
  return (
    <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% <span className="text-muted-foreground">vs {formatMonth(previousMonth)}</span>
    </span>
  );
}

function AttentionBox({
  title,
  items,
  fmt,
  footer,
}: {
  title: string;
  items: AttentionItem[];
  fmt: (v: string) => string;
  footer?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between p-6 pb-3">
        <h3 className="font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {items.length > 0 && <Pill tone="border-border bg-muted text-foreground">{items.length}</Pill>}
      </div>
      <ul className="flex-1 divide-y">
        {items.map((item) => {
          const s = SEVERITY[item.severity];
          return (
            <li key={item.key}>
              <Link href={item.href} className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/50">
                <s.icon className={cn("h-5 w-5 shrink-0", s.className)} aria-label={s.label} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{item.detail}</p>
                </div>
                {item.amount && <p className="whitespace-nowrap font-semibold">{fmt(item.amount)}</p>}
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="flex items-center gap-2 px-6 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            All clear.
          </li>
        )}
      </ul>
      {footer && <div className="border-t px-6 py-3 text-xs text-muted-foreground">{footer}</div>}
    </section>
  );
}

function GroupView({ month, onMonth }: { month: string | null; onMonth: (m: string) => void }) {
  const { switchOrganization } = useSession();
  const [data, setData] = useState<GroupDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<GroupDashboard>(`/dashboard/group${month ? `?month=${month}` : ""}`)
      .then((d) => {
        setData(d);
        onMonth(d.month);
      })
      .catch((err: Error) => setError(err.message));
  }, [month, onMonth]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  const cell = (v: string, cur: string) => (cur === "INR" ? compactInr(v) : money(v, cur));

  return (
    <div className="space-y-6">
      {data.total && data.currency && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Group gross" value={cell(data.total.gross, data.currency)} icon={Coins} tone="slate" />
          <StatCard label="Group net after CMS" value={cell(data.total.net, data.currency)} icon={Landmark} />
          <StatCard label="Group cash received" value={cell(data.total.received, data.currency)} icon={Banknote} tone="green" />
          <StatCard label="Group outstanding" value={cell(data.total.outstanding, data.currency)} icon={AlertTriangle} tone="amber" />
        </div>
      )}
      {!data.total && <Notice kind="info">Companies report in different currencies, so there is no combined total.</Notice>}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company · {formatMonth(data.month)}</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">CMS fee</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.companies.map((c) => (
              <TableRow key={c.organization_id}>
                <TableCell>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.closed ? "Month closed" : "Month open"}
                    {!c.complete && " · numbers incomplete"}
                  </p>
                </TableCell>
                <TableCell className="text-right">{cell(c.gross, c.base_currency)}</TableCell>
                <TableCell className="text-right">{cell(c.fee, c.base_currency)}</TableCell>
                <TableCell className="text-right font-semibold">{cell(c.net, c.base_currency)}</TableCell>
                <TableCell className="text-right">{cell(c.received, c.base_currency)}</TableCell>
                <TableCell className="text-right">{cell(c.outstanding, c.base_currency)}</TableCell>
                <TableCell className="text-right">
                  {c.current ? (
                    <span className="text-xs text-muted-foreground">Current</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => switchOrganization(c.organization_id)}>
                      Open
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CompanyView({ data }: { data: Dashboard }) {
  const cur = data.base_currency;
  const fmt = (v: string) => (cur === "INR" ? compactInr(v) : money(v, cur));
  const prev = shiftMonth(data.month, -1);
  const m = data.month;
  const recovery = data.recovery_pct === null ? null : Number(data.recovery_pct);

  return (
    <div className="space-y-8">
      {!data.current.complete && (
        <Notice kind="warning">
          Some numbers for {formatMonth(m)} are missing a fee schedule or FX rate.{" "}
          <Link href={`/finance?month=${m}`} className="font-medium underline">
            See finance
          </Link>
        </Notice>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross earned"
          value={fmt(data.current.gross)}
          icon={Coins}
          tone="slate"
          href={`/finance?month=${m}`}
          hint={change(data.current.gross, data.previous.gross, prev)}
        />
        <StatCard
          label="Net after CMS"
          value={fmt(data.current.net)}
          icon={Landmark}
          href={`/finance?month=${m}`}
          hint={<span>CMS fee {fmt(data.current.fee)}</span>}
        />
        <StatCard
          label="Cash received"
          value={fmt(data.current.received)}
          icon={Banknote}
          tone="green"
          href={`/finance?month=${m}`}
          hint={<span>Outstanding this month {fmt(data.current.outstanding)}</span>}
        />
        <StatCard
          label="Deal recovery"
          value={recovery === null ? "—" : `${recovery}%`}
          icon={TrendingUp}
          tone="amber"
          href="/deals"
          hint={
            recovery === null ? (
              <span>No fixed-fee deals yet</span>
            ) : (
              <span>
                {fmt(data.net_contribution)} of {fmt(data.rights_cost)} rights cost
              </span>
            )
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <AttentionBox title="Money needing attention" items={data.money} fmt={fmt} />
        <AttentionBox
          title="Operations needing attention"
          items={data.operations}
          fmt={fmt}
          footer={
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Monetization investigations and viral follow-ups appear here once YouTube/Meta are connected (Parts 6–7).
            </span>
          }
        />
      </div>

      <TrendChart points={data.trend} currency={cur} />

      <div className="grid gap-6 xl:grid-cols-5">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-3">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">CMS receivables aging</h3>
            <p className="text-sm text-muted-foreground">
              Still owed by each CMS, by days since the settlement month ended (up to {formatMonth(m)}).
            </p>
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
                <TableRow key={a.cms_id}>
                  <TableCell>
                    <Link href={`/finance/${a.cms_id}?month=${m}`} className="font-semibold hover:text-primary">
                      {a.cms_name}
                    </Link>
                  </TableCell>
                  {AGING.map(([k]) => (
                    <TableCell
                      key={k}
                      className={cn(
                        "text-right",
                        Number(a.buckets[k]) === 0 && "text-muted-foreground",
                        (k === "d61_90" || k === "d90_plus") && Number(a.buckets[k]) > 0 && "font-semibold text-red-600 dark:text-red-400",
                      )}
                    >
                      {Number(a.buckets[k]) === 0 ? "—" : fmt(a.buckets[k])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold">{fmt(a.total)}</TableCell>
                </TableRow>
              ))}
              {data.aging.length === 0 && <EmptyRow colSpan={6}>No CMS owes anything.</EmptyRow>}
            </TableBody>
          </Table>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-2">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Top people</h3>
            <p className="text-sm text-muted-foreground">Gross of the channels they managed in {formatMonth(m)}, and their incentive.</p>
          </div>
          <Table>
            <TableBody>
              {data.people.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell className="w-8 text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Link href={`/people/${p.id}`} className="font-semibold hover:text-primary">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {p.channels ? `${p.channels} channel${p.channels > 1 ? "s" : ""} · ${fmt(p.gross)}` : "Team lead"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="font-semibold">{fmt(p.incentive)}</p>
                    <p className="text-xs text-muted-foreground">incentive</p>
                  </TableCell>
                </TableRow>
              ))}
              {data.people.length === 0 && <EmptyRow colSpan={3}>No incentives this month.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-3">
          <div className="flex items-center justify-between p-6 pb-4">
            <div>
              <h3 className="text-lg font-semibold">Deal recovery</h3>
              <p className="text-sm text-muted-foreground">Net contribution so far against the rights cost (all months).</p>
            </div>
            <Link href="/deals" className="text-sm font-medium text-primary hover:underline">
              All deals
            </Link>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal</TableHead>
                <TableHead className="text-right">Rights cost</TableHead>
                <TableHead className="w-48">Recovered</TableHead>
                <TableHead className="text-right">Still payable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.deals.map((d) => {
                const pct = d.recovery_pct === null ? 0 : Number(d.recovery_pct);
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/deals/${d.id}`} className="font-semibold hover:text-primary">
                        {d.title}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        {d.owner}
                        <Pill tone={DEAL_STATUS_TONES[d.status]}>{DEAL_STATUS_LABELS[d.status]}</Pill>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{fmt(d.rights_cost)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                        </div>
                        <span className="w-12 text-right text-sm font-medium">{pct}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{fmt(d.payable)}</TableCell>
                  </TableRow>
                );
              })}
              {data.deals.length === 0 && <EmptyRow colSpan={4}>No fixed-fee deals with a licence fee yet.</EmptyRow>}
            </TableBody>
          </Table>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-2">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Top channels</h3>
            <p className="text-sm text-muted-foreground">By gross in {formatMonth(m)}.</p>
          </div>
          <Table>
            <TableBody>
              {data.channels.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/channels/${c.id}`} className="font-semibold hover:text-primary">
                      {c.name}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                      {c.manager ?? "No manager"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{fmt(c.gross)}</TableCell>
                </TableRow>
              ))}
              {data.channels.length === 0 && <EmptyRow colSpan={2}>No revenue imported for this month.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      </div>
    </div>
  );
}

function DashboardPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useSession();
  const organization = useOrganization();
  const view = params.get("view") === "group" ? "group" : "company";
  const requested = params.get("month");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupMonth, setGroupMonth] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "company") return;
    setData(null);
    setError(null);
    api<Dashboard>(`/dashboard${requested ? `?month=${requested}` : ""}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [requested, view, organization.id]);

  const month = requested ?? (view === "group" ? groupMonth : data?.month) ?? null;
  function go(change: { month?: string; view?: string }) {
    const next = new URLSearchParams(params);
    if (change.month) next.set("month", change.month);
    if (change.view) {
      if (change.view === "group") next.set("view", "group");
      else next.delete("view");
      if (!next.get("month") && month) next.set("month", month);
    }
    router.replace(`/?${next}`);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${me.user.full_name.split(" ")[0]}`}
        description={view === "group" ? "All your companies side by side." : `${organization.name} — money and operations on one screen.`}
        actions={
          me.organizations.length > 1 ? (
            <div className="flex rounded-xl border bg-card p-1 shadow-sm" role="tablist">
              {(["company", "group"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => go({ view: v })}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "company" ? organization.name : "All companies"}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {month && (
        <div className="flex">
          <MonthPicker month={month} onChange={(m) => go({ month: m })} />
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}

      {view === "group" ? (
        <GroupView month={requested} onMonth={setGroupMonth} />
      ) : data ? (
        <CompanyView data={data} />
      ) : (
        !error && <p className="text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}

export default function DashboardPageWrapper() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <DashboardPage />
    </Suspense>
  );
}
