"use client";

import { AlertTriangle, ArrowRight, Banknote, Check, CircleDollarSign, FileSpreadsheet, Lock, Settings2, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { compactInr, formatMonth, money } from "@/lib/finance";
import type { CloseStatus, CmsMonth, FinanceMonth } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---- The month's lifecycle --------------------------------------------------------------------
//
// Money for a month moves through the same stages every time:
//   earnings come in → fees & rate are set → the CMS sheet is checked → the CMS pays
//   → incentives are approved → the month is locked.
// Each stage is done, the current one, or still ahead; each CMS also gets its own small track.

export type StageKey = "revenue" | "setup" | "sheet" | "paid" | "incentives" | "closed";
export type Item = { key: string; text: string; sub?: string; done: boolean; href: string; action: string };
export type Stage = { key: StageKey; title: string; icon: React.ComponentType<{ className?: string }>; summary: string; help: string; items: Item[]; done: boolean };

export const hasFxGap = (r: CmsMonth) => r.warnings.some((w) => w.includes("rate"));
export const hasFeeGap = (r: CmsMonth) => r.warnings.some((w) => !w.includes("rate"));
export const sheetOk = (r: CmsMonth) => r.statement_net !== null && Number(r.variance ?? 0) === 0;
export const isPaid = (r: CmsMonth) => !hasFxGap(r) && Number(r.net_base ?? 0) > 0 && Number(r.outstanding ?? 0) <= 0;

export function stages(month: string, data: FinanceMonth, status: CloseStatus | null): Stage[] {
  const m = `month=${month}`;
  const cms = data.rows.filter((r) => r.cms_id);
  const earning = data.rows.filter((r) => Number(r.gross) > 0);
  const channels = earning.reduce((s, r) => s + r.channel_count, 0);

  // One rate per currency, not one per CMS.
  const fxMissing = [...new Set(cms.filter(hasFxGap).map((r) => r.currency ?? "USD"))];
  const setupItems: Item[] = [
    ...fxMissing.map((cur) => ({
      key: `fx-${cur}`,
      text: `Set the ${cur} → ${data.base_currency} rate for ${formatMonth(month)}`,
      sub: "Needed to turn what the CMS pays into rupees.",
      done: false,
      href: `/finance/fx?${m}`,
      action: "Set rate",
    })),
    ...cms.map((r) => ({
      key: `fee-${r.cms_id}`,
      text: hasFeeGap(r) ? `Add ${r.cms_name}'s fee slabs` : `${r.cms_name} fee slabs`,
      sub: hasFeeGap(r) ? r.warnings.find((w) => !w.includes("rate")) : (r.fee_rule ?? undefined),
      done: !hasFeeGap(r),
      href: `/cms-partners/${r.cms_id}${hasFeeGap(r) ? "?tiers=new" : ""}`,
      action: hasFeeGap(r) ? "Add slabs" : "View",
    })),
  ];

  const incentives = status?.checks.find((c) => c.key === "incentives");
  const paidCount = cms.filter(isPaid).length;
  const sheetCount = cms.filter(sheetOk).length;

  return [
    {
      key: "revenue",
      title: "Earnings in",
      icon: CircleDollarSign,
      summary: earning.length ? `${channels} channels earning` : "Nothing yet",
      help: "What each channel earned. YouTube sends an estimate every day; the CMS sheet replaces it with the final figure.",
      done: earning.length > 0,
      items: earning.length
        ? earning.map((r) => ({
            key: `rev-${r.cms_id ?? "none"}`,
            text: `${r.cms_name}: ${money(r.gross, r.currency)}`,
            sub: `${r.channel_count} channel${r.channel_count === 1 ? "" : "s"}${r.statement_net === null ? " · YouTube estimate until the CMS sheet arrives" : " · final, from the CMS sheet"}`,
            done: true,
            href: `/finance/revenue?${m}`,
            action: "See lines",
          }))
        : [{ key: "rev", text: `No earnings for ${formatMonth(month)} yet`, sub: "Connect YouTube channels or upload the CMS sheet.", done: false, href: `/finance/revenue?${m}`, action: "Add earnings" }],
    },
    {
      key: "setup",
      title: "Fees & rate",
      icon: Settings2,
      summary: setupItems.every((i) => i.done) ? "All set" : `${setupItems.filter((i) => !i.done).length} missing`,
      help: "Each CMS's fee slabs and this month's exchange rate. Without them the tool cannot work out what is owed.",
      done: cms.length > 0 && setupItems.every((i) => i.done),
      items: setupItems,
    },
    {
      key: "sheet",
      title: "CMS sheet",
      icon: FileSpreadsheet,
      summary: cms.length ? `${sheetCount} of ${cms.length} checked` : "—",
      help: "Upload each CMS's monthly sheet. It sets the final earnings and is checked against our numbers channel by channel.",
      done: cms.length > 0 && sheetCount === cms.length,
      items: cms.map((r) => {
        const differs = r.statement_net !== null && Number(r.variance ?? 0) !== 0;
        return {
          key: `sheet-${r.cms_id}`,
          text: r.statement_net === null ? `Upload ${r.cms_name}'s sheet` : differs ? `${r.cms_name}'s sheet differs by ${money(r.variance, r.currency)}` : `${r.cms_name}'s sheet matches`,
          sub: r.statement_net === null ? "Not received yet." : differs ? "Find the channel and record a correction." : undefined,
          done: sheetOk(r),
          href: `/finance/${r.cms_id}?${m}&tab=statement`,
          action: r.statement_net === null ? "Upload" : "Open",
        };
      }),
    },
    {
      key: "paid",
      title: "Money received",
      icon: Banknote,
      summary: cms.length ? `${paidCount} of ${cms.length} paid` : "—",
      help: "Record each payment that reaches the bank. What is still owed goes down on its own.",
      done: cms.length > 0 && paidCount === cms.length,
      items: cms.map((r) => ({
        key: `paid-${r.cms_id}`,
        text: isPaid(r) ? `${r.cms_name} has paid in full` : `${r.cms_name}: ${hasFxGap(r) ? `owes ${money(r.net, r.currency)}` : `${compactInr(r.outstanding)} still to come`}`,
        sub: isPaid(r) ? undefined : Number(r.received) > 0 ? `${compactInr(r.received)} received so far.` : "Nothing received yet.",
        done: isPaid(r),
        href: `/finance/${r.cms_id}?${m}&tab=cash`,
        action: "Record payment",
      })),
    },
    {
      key: "incentives",
      title: "Incentives",
      icon: Users,
      summary: incentives?.ok ? "Approved" : "Not approved",
      help: "Each manager's and team lead's % of the gross. Approve them for payout.",
      done: Boolean(incentives?.ok),
      items: [
        {
          key: "inc",
          text: incentives?.ok ? "Incentives approved" : `Work out and approve ${formatMonth(month)} incentives`,
          sub: incentives?.ok ? undefined : incentives?.message,
          done: Boolean(incentives?.ok),
          href: `/finance/incentives?${m}`,
          action: "Open",
        },
      ],
    },
    {
      key: "closed",
      title: "Month locked",
      icon: Lock,
      summary: status?.closed ? "Locked" : status?.can_close ? "Ready" : "Open",
      help: "Locking stops the month's numbers from changing. Later corrections go in as adjustments.",
      done: Boolean(status?.closed),
      items: [
        {
          key: "close",
          text: status?.closed ? `${formatMonth(month)} is locked` : status?.can_close ? `Lock ${formatMonth(month)}` : "Finish the steps above, then lock the month",
          sub: status?.closed ? undefined : status?.checks.filter((c) => !c.ok && c.blocking).map((c) => c.message).join(" · ") || undefined,
          done: Boolean(status?.closed),
          href: `/finance/close?${m}`,
          action: status?.closed ? "View" : "Lock month",
        },
      ],
    },
  ];
}

export function Track({ list, current, selected, onSelect }: { list: Stage[]; current: number; selected: number; onSelect: (i: number) => void }) {
  return (
    <ol className="-mx-2 flex overflow-x-auto pb-1">
      {list.map((s, i) => {
        const state = s.done ? "done" : i === current ? "current" : "ahead";
        const Icon = s.icon;
        return (
          <li key={s.key} className="min-w-[8.5rem] flex-1">
            <button type="button" onClick={() => onSelect(i)} aria-current={i === selected ? "step" : undefined} className={cn("group w-full rounded-xl px-2 py-3 text-center transition-colors hover:bg-muted/50", i === selected && "bg-primary/5 ring-1 ring-primary/30")}>
              <div className="flex items-center">
                <span className={cn("h-1 flex-1 rounded-full", i === 0 ? "invisible" : list[i - 1].done ? "bg-emerald-500" : "bg-border")} />
                <span
                  className={cn(
                    "relative grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 transition-transform group-hover:scale-105",
                    state === "done" && "border-emerald-500 bg-emerald-500 text-white",
                    state === "current" && "border-primary bg-primary/10 text-primary ring-4 ring-primary/15",
                    state === "ahead" && "border-border bg-card text-muted-foreground",
                  )}
                >
                  {s.done ? <Check className="h-5 w-5" strokeWidth={3} /> : <Icon className="h-5 w-5" />}
                </span>
                <span className={cn("h-1 flex-1 rounded-full", i === list.length - 1 ? "invisible" : s.done ? "bg-emerald-500" : "bg-border")} />
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Step {i + 1}</p>
              <p className={cn("font-semibold", state === "current" && "text-primary")}>{s.title}</p>
              <p className={cn("text-xs", s.done ? "text-emerald-700 dark:text-emerald-400" : state === "current" ? "text-primary" : "text-muted-foreground")}>{s.summary}</p>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StagePanel({ stage, index }: { stage: Stage; index: number }) {
  const open = stage.items.filter((i) => !i.done);
  const done = stage.items.filter((i) => i.done);
  return (
    <div className="rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Step {index + 1} · {stage.done ? "done" : "to do"}
          </p>
          <p className="mt-0.5 text-lg font-semibold">{stage.title}</p>
          <p className="text-sm text-muted-foreground">{stage.help}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {[...open, ...done].map((it) => (
          <li key={it.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
                  it.done ? "bg-emerald-500 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
                )}
              >
                {it.done ? <Check className="h-3 w-3" strokeWidth={3} /> : <AlertTriangle className="h-3 w-3" />}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{it.text}</p>
                {it.sub && <p className="text-sm text-muted-foreground">{it.sub}</p>}
              </div>
            </div>
            <Button size="sm" variant={it.done ? "outline" : "default"} asChild>
              <Link href={it.href}>
                {it.action}
                {!it.done && <ArrowRight />}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A CMS's own progress: earnings → fee slabs → sheet → paid.
export function MiniTrack({ r }: { r: CmsMonth }) {
  const steps: [string, boolean][] = [
    ["Earnings", Number(r.gross) > 0],
    ["Fee slabs & rate", r.warnings.length === 0],
    ["Sheet checked", sheetOk(r)],
    ["Paid", isPaid(r)],
  ];
  const next = steps.findIndex(([, ok]) => !ok);
  return (
    <div className="flex items-center" aria-label={steps.map(([l, ok]) => `${l}: ${ok ? "done" : "not yet"}`).join(", ")}>
      {steps.map(([label, ok], i) => (
        <span key={label} className="flex items-center" title={`${label}: ${ok ? "done" : "not yet"}`}>
          {i > 0 && <span className={cn("h-0.5 w-5", steps[i - 1][1] ? "bg-emerald-500" : "bg-border")} />}
          <span
            className={cn(
              "h-3 w-3 rounded-full border-2",
              ok ? "border-emerald-500 bg-emerald-500" : i === next ? "border-primary bg-primary/20" : "border-border bg-card",
            )}
          />
        </span>
      ))}
      <span className="ml-3 whitespace-nowrap text-xs text-muted-foreground">{next === -1 ? "All done" : steps[next][0]}</span>
    </div>
  );
}
