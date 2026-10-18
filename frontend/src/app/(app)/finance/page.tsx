"use client";

import { AlertTriangle, ArrowRight, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { useFinanceMonth } from "@/components/finance/finance-shell";
import { MoneyFlow, MonthSteps } from "@/components/finance/money-flow";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES } from "@/lib/deals";
import { compactInr, formatMonth, money } from "@/lib/finance";
import { HELP } from "@/lib/help";
import type { CloseStatus, CmsMonth, FinanceMonth } from "@/lib/types";

/** Where a CMS stands for the month, in one word. */
function payStatus(r: CmsMonth): { label: string; tone: string } {
  if (!r.cms_id) return { label: "No CMS", tone: DEAL_STATUS_TONES.expired };
  if (r.warnings.length) return { label: "Setup missing", tone: DEAL_STATUS_TONES.draft };
  const net = Number(r.net_base ?? 0);
  const out = Number(r.outstanding ?? 0);
  if (net > 0 && out <= 0) return { label: "Paid", tone: DEAL_STATUS_TONES.active };
  if (Number(r.received) > 0) return { label: "Partly paid", tone: DEAL_STATUS_TONES.draft };
  return { label: "Not paid yet", tone: DEAL_STATUS_TONES.terminated };
}

function statementCell(r: CmsMonth) {
  if (!r.cms_id) return <span className="text-muted-foreground">—</span>;
  if (r.statement_net === null) return <Pill tone={DEAL_STATUS_TONES.expired}>Not entered</Pill>;
  if (r.variance === null || Number(r.variance) === 0) return <Pill tone={DEAL_STATUS_TONES.active}>Matches</Pill>;
  return <Pill tone={DEAL_STATUS_TONES.draft}>Differs {money(r.variance, r.currency)}</Pill>;
}

function FinanceOverview() {
  const router = useRouter();
  const [month] = useFinanceMonth();
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [status, setStatus] = useState<CloseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const base = data?.base_currency ?? "INR";
  const fmt = (v: string | null | undefined) => (base === "INR" ? compactInr(v) : money(v, base));
  const adjustments = data ? data.rows.reduce((n, r) => n + Number(r.adjustments), 0) : 0;

  return (
    <div className="space-y-6">
      {status && <MonthSteps status={status} />}
      {error && <Notice kind="error">{error}</Notice>}
      {data?.incomplete && (
        <Notice kind="warning">Some numbers for {formatMonth(month)} are missing a fee schedule or FX rate — see the CMS rows below.</Notice>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              {formatMonth(month)}: from earnings to cash
              <InfoTip text={HELP.outstanding} />
            </h3>
            <p className="text-sm text-muted-foreground">All CMS partners together, in {base}. Foreign revenue converted at the month&apos;s FX rate.</p>
          </div>
          <Button asChild>
            <Link href={`/finance/revenue?month=${month}`}>
              <Upload />
              Import revenue
            </Link>
          </Button>
        </div>
        {data && (
          <MoneyFlow
            steps={[
              { label: "Gross revenue", value: fmt(data.gross), info: HELP.grossRevenue, sub: "What the platforms reported" },
              { label: "CMS commission", value: fmt(data.fee), op: "−", tone: "minus", info: HELP.cmsCommission },
              { label: "Net receivable", value: fmt(data.net_receivable), op: "=", info: HELP.netReceivable, sub: "What CMS partners owe" },
              {
                label: "Cash received",
                value: fmt(data.received),
                op: "−",
                tone: "minus",
                info: HELP.cashReceived,
                sub: adjustments ? `Adjustments ${fmt(String(adjustments))}` : undefined,
              },
              {
                label: "Outstanding",
                value: fmt(data.outstanding),
                op: "=",
                tone: Number(data.outstanding) > 0 ? "warn" : "result",
                info: HELP.outstanding,
                sub: Number(data.outstanding) > 0 ? "Still to come from CMS partners" : "Nothing owed",
              },
            ]}
          />
        )}
        {data && Number(data.fx_difference) !== 0 && (
          <p className="text-xs text-muted-foreground">
            FX {Number(data.fx_difference) > 0 ? "gain" : "loss"} on receipts this month: {money(data.fx_difference, base)}
            <InfoTip text={HELP.fxDifference} />
          </p>
        )}
      </section>

      <section id="cms-breakdown" className="scroll-mt-24 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-6 pb-4">
          <h3 className="text-lg font-semibold">
            By CMS partner
            <InfoTip text={HELP.cms} />
          </h3>
          <p className="text-sm text-muted-foreground">Click a CMS to see its channels, enter its statement and record what it paid.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CMS</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">CMS fee</TableHead>
              <TableHead className="text-right">Net due</TableHead>
              <TableHead>
                Their statement
                <InfoTip text={HELP.variance} />
              </TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.map((r) => {
              const st = payStatus(r);
              return (
                <TableRow
                  key={r.cms_id ?? "none"}
                  className="cursor-pointer align-top"
                  onClick={() => router.push(`/finance/${r.cms_id ?? "none"}?month=${month}`)}
                >
                  <TableCell>
                    <p className="font-semibold">{r.cms_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.channel_count} channel{r.channel_count === 1 ? "" : "s"}
                      {r.fee_rule ? ` · ${r.fee_rule}` : ""}
                    </p>
                    {r.warnings.map((w) => (
                      <p key={w} className="mt-1 flex items-start gap-1 text-xs text-amber-600">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">{money(r.gross, r.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{r.fee === null ? "—" : money(r.fee, r.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">
                    {r.net === null ? "—" : money(r.net, r.currency)}
                    {r.net_base && r.currency !== base && <span className="block text-xs font-normal text-muted-foreground">{money(r.net_base, base)}</span>}
                  </TableCell>
                  <TableCell>{statementCell(r)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{money(r.received, base)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{r.cms_id ? money(r.outstanding, base) : "—"}</TableCell>
                  <TableCell>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              );
            })}
            {data && data.rows.length === 0 && (
              <EmptyRow colSpan={9}>
                No revenue or payments for {formatMonth(month)} yet.{" "}
                <Link href={`/finance/revenue?month=${month}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  Import revenue
                </Link>
              </EmptyRow>
            )}
          </TableBody>
        </Table>
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
