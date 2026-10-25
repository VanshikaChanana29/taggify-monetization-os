"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useFinanceMonth } from "@/components/finance/finance-shell";
import { hasFxGap, MiniTrack, stages, StagePanel, Track } from "@/components/finance/lifecycle";
import { MoneyFlow } from "@/components/finance/money-flow";
import { PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr, formatMonth, money } from "@/lib/finance";
import { HELP } from "@/lib/help";
import type { CloseStatus, CmsMonth, FinanceMonth } from "@/lib/types";

function FinanceOverview() {
  const router = useRouter();
  const params = useSearchParams();
  const [month] = useFinanceMonth();
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [status, setStatus] = useState<CloseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setPicked(null);
    api<FinanceMonth>(`/finance/settlements?month=${month}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
    api<CloseStatus>(`/finance/close?month=${month}`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [month]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <PageLoader />;

  const list = stages(month, data, status);
  const current = Math.max(0, list.findIndex((s) => !s.done));
  const allDone = list.every((s) => s.done);
  // ?step=paid etc. opens that step (the dashboard links straight to it).
  const asked = list.findIndex((s) => s.key === params.get("step"));
  const selected = picked ?? (asked >= 0 ? asked : allDone ? list.length - 1 : current);
  const doneCount = list.filter((s) => s.done).length;

  // CMS partners report in their own currency (USD). Show their totals in it, so a missing
  // exchange rate never turns real earnings into ₹0.
  const cms = data.rows.filter((r) => r.cms_id);
  const currencies = [...new Set(cms.map((r) => r.currency))];
  const cur = currencies.length === 1 ? currencies[0] : null;
  const sum = (f: (r: CmsMonth) => string | null) => cms.reduce((s, r) => s + Number(f(r) ?? 0), 0);
  const fxGap = cms.some(hasFxGap);
  const base = data.base_currency;
  const inBase = (v: string | number | null) => (base === "INR" ? compactInr(v) : money(v, base));

  return (
    <div className="space-y-6">
      {/* 1. Where the month stands */}
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{formatMonth(month)} · month lifecycle</h3>
            <p className="text-sm text-muted-foreground">
              {allDone ? "Every step is done — this month is settled." : `${doneCount} of ${list.length} steps done. Click a step to see what it needs.`}
            </p>
          </div>
          {!allDone && (
            <Button size="sm" onClick={() => setPicked(current)} variant="outline">
              Go to current step
            </Button>
          )}
        </div>
        <Track list={list} current={current} selected={selected} onSelect={setPicked} />
        <div className="mt-5">
          <StagePanel stage={list[selected]} index={selected} />
        </div>
      </section>

      {/* 2. The money, left to right */}
      {cms.length > 0 && (
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Where the money is</h3>
          <p className="mb-4 text-sm text-muted-foreground">All CMS partners together, {formatMonth(month)}.</p>
          <MoneyFlow
            steps={[
              {
                label: "Earned",
                value: cur ? money(sum((r) => r.gross), cur) : inBase(data.gross),
                info: HELP.grossRevenue,
                sub: cur && !fxGap && cur !== base ? `≈ ${inBase(data.gross)}` : undefined,
              },
              { label: "CMS fees", value: cur ? money(sum((r) => r.fee), cur) : inBase(data.fee), op: "−", tone: "minus", info: HELP.feeTiers },
              {
                label: "CMS owes us",
                value: cur ? money(sum((r) => r.net), cur) : inBase(data.net_receivable),
                op: "=",
                info: HELP.netReceivable,
                sub: cur && !fxGap && cur !== base ? `≈ ${inBase(data.net_receivable)}` : undefined,
              },
              { label: "Received", value: inBase(data.received), op: "−", tone: "minus", info: HELP.cashReceived, sub: "In the bank" },
              {
                label: "Still to come",
                value: fxGap ? "Set rate" : inBase(data.outstanding),
                op: "=",
                tone: fxGap || Number(data.outstanding) > 0 ? "warn" : "result",
                info: HELP.outstanding,
                sub: fxGap ? `Needs this month's ${cur ?? ""} rate`.replace("  ", " ") : Number(data.outstanding) > 0 ? "Follow up with the CMS" : "Nothing owed",
              },
            ]}
          />
        </section>
      )}

      {/* 3. Each CMS and how far it has got */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-6 pb-4">
          <h3 className="text-lg font-semibold">CMS partners · {formatMonth(month)}</h3>
          <p className="text-sm text-muted-foreground">Click a CMS to upload its sheet, record payments or see its channels.</p>
        </div>
        {data.rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No.</TableHead>
                <TableHead>CMS</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Owes us</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Still to come</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r, idx) => {
                const href = `/finance/${r.cms_id ?? "none"}?month=${month}`;
                return (
                  <TableRow key={r.cms_id ?? "none"} className="cursor-pointer" onClick={() => router.push(href)}>
                    <TableCell className="w-14 tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <p className="whitespace-nowrap font-semibold">{r.cms_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.channel_count} channel{r.channel_count === 1 ? "" : "s"}
                      </p>
                    </TableCell>
                    <TableCell>{r.cms_id ? <MiniTrack r={r} /> : <span className="text-xs text-muted-foreground">No CMS — nothing to collect</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.gross, r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.fee === null ? "—" : money(r.fee, r.currency)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{r.net === null ? "—" : money(r.net, r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.cms_id ? compactInr(r.received) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {!r.cms_id ? "—" : hasFxGap(r) ? <span className="text-xs text-amber-700 dark:text-amber-400">Set rate</span> : compactInr(r.outstanding)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="m-6 mt-0 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No earnings for {formatMonth(month)} yet.{" "}
            <Link href={`/finance/revenue?month=${month}`} className="font-medium text-primary hover:underline">
              Add earnings
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
    <Suspense fallback={<PageLoader />}>
      <FinanceOverview />
    </Suspense>
  );
}
