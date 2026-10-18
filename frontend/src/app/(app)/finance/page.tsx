"use client";

import { ArrowRight, CheckCircle2, ChevronDown, Circle, Hourglass, Landmark, Wallet } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";

import { useFinanceMonth } from "@/components/finance/finance-shell";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES } from "@/lib/deals";
import { compactInr, formatMonth, money } from "@/lib/finance";
import { HELP } from "@/lib/help";
import type { CloseStatus, CmsMonth, FinanceMonth } from "@/lib/types";
import { cn } from "@/lib/utils";

type Task = { key: string; title: string; why: string; href: string; action: string; done: boolean; blocked?: boolean };

/** The month's to-do list, in the order finance works through it (PDF slide 16). */
function tasks(month: string, data: FinanceMonth, status: CloseStatus | null): Task[] {
  const label = formatMonth(month);
  const m = `month=${month}`;
  const list: Task[] = [
    {
      key: "revenue",
      title: `Import ${label} revenue`,
      why: "Upload what each channel earned this month.",
      href: `/finance/revenue?${m}`,
      action: "Import revenue",
      done: Number(data.gross) > 0,
    },
  ];
  for (const r of data.rows.filter((x) => x.cms_id && x.warnings.length)) {
    const fx = r.warnings.some((w) => w.includes("rate"));
    list.push({
      key: `setup-${r.cms_id}`,
      title: fx ? `Set the ${r.currency} rate for ${label}` : `Add ${r.cms_name}'s fee tiers`,
      why: r.warnings[0],
      href: fx ? "/finance/fx" : `/cms-partners/${r.cms_id}`,
      action: fx ? "Set rate" : "Add fee tiers",
      done: false,
    });
  }
  for (const r of data.rows.filter((x) => x.cms_id)) {
    const base = `/finance/${r.cms_id}?${m}`;
    const differs = r.variance !== null && Number(r.variance) !== 0;
    list.push({
      key: `statement-${r.cms_id}`,
      title: r.statement_net === null ? `Upload ${r.cms_name}'s statement` : differs ? `Check ${r.cms_name}'s statement` : `${r.cms_name}'s statement matches`,
      why:
        r.statement_net === null
          ? "Compare what the CMS says with our numbers, channel by channel."
          : differs
            ? `It differs from ours by ${money(r.variance, r.currency)} — find the channel and record an adjustment.`
            : "Their numbers agree with ours.",
      href: `${base}&tab=statement`,
      action: r.statement_net === null ? "Upload statement" : "Open statement",
      done: r.statement_net !== null && !differs,
    });
    const out = Number(r.outstanding ?? 0);
    const paid = Number(r.net_base ?? 0) > 0 && out <= 0;
    list.push({
      key: `cash-${r.cms_id}`,
      title: paid ? `${r.cms_name} has paid` : `Record the money ${r.cms_name} paid`,
      why: paid ? "Nothing is owed for this month." : `${money(r.outstanding, data.base_currency)} still to come. Check the bank and record each payment.`,
      href: `${base}&tab=cash`,
      action: "Record payment",
      done: paid,
    });
  }
  const incentives = status?.checks.find((c) => c.key === "incentives");
  list.push({
    key: "incentives",
    title: `Approve ${label} incentives`,
    why: "Each manager's and team lead's % of the gross, for payout.",
    href: `/finance/incentives?${m}`,
    action: "Open incentives",
    done: Boolean(incentives?.ok),
  });
  list.push({
    key: "close",
    title: `Close ${label}`,
    why: status?.can_close || status?.closed ? "Locks the month so its numbers cannot change silently." : "Possible once incentives are approved and every CMS has fee tiers and an FX rate.",
    href: `/finance/close?${m}`,
    action: "Close month",
    done: Boolean(status?.closed),
    blocked: !status?.closed && !status?.can_close,
  });
  return list;
}

function payState(r: CmsMonth): { label: string; tone: string } {
  if (r.warnings.length) return { label: "Setup missing", tone: DEAL_STATUS_TONES.draft };
  const out = Number(r.outstanding ?? 0);
  if (Number(r.net_base ?? 0) > 0 && out <= 0) return { label: "Paid", tone: DEAL_STATUS_TONES.active };
  if (Number(r.received) > 0) return { label: "Partly paid", tone: DEAL_STATUS_TONES.draft };
  return { label: "Not paid yet", tone: DEAL_STATUS_TONES.terminated };
}

function CmsCard({ r, month }: { r: CmsMonth; month: string }) {
  const st = payState(r);
  const net = Number(r.net_base ?? 0);
  const pct = net > 0 ? Math.min(100, Math.max(0, (Number(r.received) / net) * 100)) : 0;
  const statement =
    r.statement_net === null ? "Statement not uploaded" : r.variance !== null && Number(r.variance) !== 0 ? `Statement differs by ${money(r.variance, r.currency)}` : "Statement matches";
  return (
    <Link href={`/finance/${r.cms_id ?? "none"}?month=${month}`} className="group flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{r.cms_name}</p>
          <p className="text-xs text-muted-foreground">
            {r.channel_count} channel{r.channel_count === 1 ? "" : "s"} · earned {money(r.gross, r.currency)}
          </p>
        </div>
        {r.cms_id && <Pill tone={st.tone}>{st.label}</Pill>}
      </div>
      {r.cms_id ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Owes us</p>
              <p className="font-semibold">{compactInr(r.net_base)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Received</p>
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">{compactInr(r.received)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Still due</p>
              <p className="font-semibold">{compactInr(r.outstanding)}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" title={`${Math.round(pct)}% received`}>
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
          </div>
          <p className={cn("mt-3 text-xs", r.statement_net !== null && Number(r.variance ?? 0) === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
            {statement}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">These channels have no CMS — their earnings are not collected by a partner.</p>
      )}
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
        Open {r.cms_name} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function FinanceOverview() {
  const [month] = useFinanceMonth();
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [status, setStatus] = useState<CloseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    api<FinanceMonth>(`/finance/settlements?month=${month}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
    api<CloseStatus>(`/finance/close?month=${month}`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [month]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;

  const list = tasks(month, data, status);
  const todo = list.filter((t) => !t.done);
  const done = list.filter((t) => t.done);
  const next = todo.find((t) => !t.blocked) ?? todo[0];
  const fmt = (v: string | null | undefined) => (data.base_currency === "INR" ? compactInr(v) : money(v, data.base_currency));

  return (
    <div className="space-y-6">
      {/* 1. What to do now */}
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">To finish {formatMonth(month)}</h3>
            <p className="text-sm text-muted-foreground">
              {todo.length === 0 ? "Everything is done for this month." : `${done.length} of ${list.length} done — work down the list.`}
            </p>
          </div>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${(done.length / list.length) * 100}%` }} />
          </div>
        </div>

        {next && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Do this next</p>
              <p className="mt-1 text-lg font-semibold">{next.title}</p>
              <p className="text-sm text-muted-foreground">{next.why}</p>
            </div>
            <Button size="lg" asChild>
              <Link href={next.href}>
                {next.action}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        )}

        {todo.length > 1 && (
          <ul className="mt-4 divide-y">
            {todo
              .filter((t) => t !== next)
              .map((t) => (
                <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-start gap-3">
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className={cn("font-medium", t.blocked && "text-muted-foreground")}>{t.title}</p>
                      <p className="text-sm text-muted-foreground">{t.why}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild disabled={t.blocked}>
                    <Link href={t.href}>{t.action}</Link>
                  </Button>
                </li>
              ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <button type="button" onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} />
              Done ({done.length})
            </button>
            {showDone && (
              <ul className="mt-2 space-y-2">
                {done.map((t) => (
                  <li key={t.key} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <Link href={t.href} className="hover:text-primary">
                      {t.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* 2. Three numbers */}
      <div className="grid gap-5 md:grid-cols-3">
        <StatCard
          label="CMS partners owe us"
          value={fmt(data.net_receivable)}
          icon={Landmark}
          tone="slate"
          info={HELP.netReceivable}
          hint={<span>Earned {fmt(data.gross)} − CMS fees {fmt(data.fee)}</span>}
        />
        <StatCard label="Received in the bank" value={fmt(data.received)} icon={Wallet} tone="green" info={HELP.cashReceived} />
        <StatCard
          label="Still to come"
          value={fmt(data.outstanding)}
          icon={Hourglass}
          tone={Number(data.outstanding) > 0 ? "amber" : "green"}
          info={HELP.outstanding}
          hint={Number(data.outstanding) > 0 ? <span>Follow up with the CMS partners below</span> : <span>Nothing owed</span>}
        />
      </div>

      {/* 3. One card per CMS */}
      <section>
        <h3 className="mb-3 text-lg font-semibold">CMS partners · {formatMonth(month)}</h3>
        {data.rows.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((r) => (
              <CmsCard key={r.cms_id ?? "none"} r={r} month={month} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No revenue for {formatMonth(month)} yet.{" "}
            <Link href={`/finance/revenue?month=${month}`} className="font-medium text-primary hover:underline">
              Import revenue
            </Link>{" "}
            to begin.
          </p>
        )}
      </section>
    </div>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <FinanceOverview />
    </Suspense>
  );
}
