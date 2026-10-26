"use client";

import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import type { CloseStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type FlowStep = {
  label: string;
  value: string;
  /** The operator before this box: "−", "+", "±", "=". */
  op?: string;
  sub?: string;
  info?: string;
  tone?: "plain" | "minus" | "result" | "warn";
};

/** Slide 10's formula as boxes: Gross − CMS fee = Net receivable − Cash ± Adjustments = Outstanding. */
export function MoneyFlow({ steps, compact = false }: { steps: FlowStep[]; compact?: boolean }) {
  return (
    <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {s.op && (
            <span aria-hidden className={cn("self-center font-light text-muted-foreground lg:px-1", compact ? "text-lg" : "text-2xl")}>
              {s.op}
            </span>
          )}
          <div
            className={cn(
              "flex-1 rounded-2xl border",
              compact ? "px-3 py-2" : "p-4",
              (s.tone ?? "plain") === "plain" && "bg-card",
              s.tone === "minus" && "bg-muted/40",
              s.tone === "result" && "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
              s.tone === "warn" && "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
              i === steps.length - 1 && "lg:flex-[1.3]",
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
              {s.info && <InfoTip text={s.info} />}
            </p>
            <p className={cn("mt-1 font-bold", compact ? "text-lg" : i === steps.length - 1 ? "text-2xl" : "text-xl")}>{s.value}</p>
            {s.sub && !compact && <p className="mt-0.5 text-xs text-muted-foreground">{s.sub}</p>}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

const STEPS: { key: string; label: string; href: (m: string) => string }[] = [
  { key: "revenue", label: "Revenue imported", href: (m) => `/finance/revenue?month=${m}` },
  { key: "pricing", label: "Fee tiers & FX rate", href: () => "/finance/fx" },
  { key: "statements", label: "CMS statements", href: (m) => `/finance?month=${m}#cms-breakdown` },
  { key: "cash", label: "Cash received", href: (m) => `/finance?month=${m}#cms-breakdown` },
  { key: "incentives", label: "Incentives approved", href: (m) => `/finance/incentives?month=${m}` },
  { key: "closed", label: "Month closed", href: (m) => `/finance/close?month=${m}` },
];

/** PDF slide 16 — where this month stands in the month-end process. */
export function MonthSteps({ status }: { status: CloseStatus }) {
  const m = status.month;
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <p className="text-sm font-semibold">
        Month-end progress
        <InfoTip text="The order finance closes a month (PDF slide 16). Green = done, amber = recommended, red = must be done before closing." />
      </p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {STEPS.map((step, i) => {
          const check = status.checks.find((c) => c.key === step.key);
          const done = step.key === "closed" ? status.closed : Boolean(check?.ok);
          const blocking = check?.blocking ?? false;
          const Icon = done ? CheckCircle2 : blocking ? AlertTriangle : step.key === "closed" ? Circle : AlertTriangle;
          return (
            <li key={step.key}>
              <Link
                href={step.href(m)}
                title={check?.message}
                className={cn(
                  "flex h-full items-start gap-2 rounded-xl border p-3 text-sm transition-colors hover:border-primary/50",
                  done && "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10",
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    done ? "text-emerald-600" : blocking ? "text-red-500" : step.key === "closed" ? "text-muted-foreground" : "text-amber-500",
                  )}
                />
                <span>
                  <span className="text-xs text-muted-foreground">Step {i + 1}</span>
                  <span className="block font-medium leading-tight">{step.label}</span>
                  {!done && check && <span className="mt-0.5 block text-xs text-muted-foreground">{check.message}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
