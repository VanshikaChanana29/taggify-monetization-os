"use client";

import { AlertTriangle, ArrowRight, Banknote, Coins, Percent, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { MonthPicker } from "@/components/month-picker";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr, money, shiftMonth, thisMonth } from "@/lib/finance";
import type { FinanceMonth } from "@/lib/types";
import { cn } from "@/lib/utils";

function FinancePage() {
  const router = useRouter();
  const params = useSearchParams();
  const month = params.get("month") ?? shiftMonth(thisMonth(), -1);
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<FinanceMonth>(`/finance/settlements?month=${month}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [month]);

  const base = data?.base_currency ?? "INR";
  const fmt = (v: string | null | undefined) => (base === "INR" ? compactInr(v) : money(v, base));

  return (
    <div className="space-y-8">
      <PageHeader
        title="CMS & Finance"
        description="From platform earnings to actual bank receipts — per CMS, per month."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/finance/fx">FX rates</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/finance/incentives?month=${month}`}>Incentives</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/finance/close?month=${month}`}>Month close</Link>
            </Button>
            <Button asChild>
              <Link href="/finance/revenue">
                <Upload />
                Import revenue
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={(m) => router.replace(`/finance?month=${m}`)} />
        {data?.incomplete && (
          <p className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            Some numbers are missing a fee schedule or FX rate — see the warnings below.
          </p>
        )}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gross revenue" value={data ? fmt(data.gross) : "…"} icon={Coins} tone="slate" />
        <StatCard label="CMS commission" value={data ? fmt(data.fee) : "…"} icon={Percent} tone="amber" />
        <StatCard label="Net receivable" value={data ? fmt(data.net_receivable) : "…"} icon={Banknote} tone="green" />
        <StatCard label="Cash received" value={data ? fmt(data.received) : "…"} icon={Banknote} />
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-foreground px-8 py-6 text-background">
        <p className="text-lg font-semibold uppercase tracking-wider">Outstanding CMS balance</p>
        <p className="text-4xl font-bold text-emerald-300">{data ? fmt(data.outstanding) : "…"}</p>
      </div>
      <p className="-mt-5 text-xs text-muted-foreground">
        Net receivable − cash received ± adjustments = outstanding (PDF slide 10). Amounts in {base}; foreign revenue converted at
        the month&apos;s FX rate.
      </p>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CMS</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead>CMS fee</TableHead>
              <TableHead>Net due</TableHead>
              <TableHead>Net ({base})</TableHead>
              <TableHead>vs statement</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.map((r) => (
              <TableRow
                key={r.cms_id ?? "none"}
                className="cursor-pointer align-top"
                onClick={() => router.push(`/finance/${r.cms_id ?? "none"}?month=${month}`)}
              >
                <TableCell>
                  <p className="font-semibold">{r.cms_name}</p>
                  <p className="text-xs text-muted-foreground">{r.channel_count} channel(s)</p>
                  {r.warnings.map((w) => (
                    <p key={w} className="mt-1 flex items-start gap-1 text-xs text-amber-600">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {w}
                    </p>
                  ))}
                </TableCell>
                <TableCell className="whitespace-nowrap">{money(r.gross, r.currency)}</TableCell>
                <TableCell className="whitespace-nowrap">{r.fee === null ? "—" : money(r.fee, r.currency)}</TableCell>
                <TableCell className="whitespace-nowrap font-semibold">{r.net === null ? "—" : money(r.net, r.currency)}</TableCell>
                <TableCell className="whitespace-nowrap">{money(r.net_base, base)}</TableCell>
                <TableCell
                  className={cn(
                    "whitespace-nowrap",
                    r.variance && Number(r.variance) !== 0 ? "font-semibold text-amber-600" : "text-muted-foreground",
                  )}
                >
                  {r.variance === null ? (r.cms_id ? "No statement" : "—") : Number(r.variance) === 0 ? "Matches" : money(r.variance, r.currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{money(r.received, base)}</TableCell>
                <TableCell className="whitespace-nowrap font-semibold">{r.cms_id ? money(r.outstanding, base) : "—"}</TableCell>
                <TableCell>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
            {data && data.rows.length === 0 && (
              <EmptyRow colSpan={9}>
                No revenue or receipts for this month.{" "}
                <Link href="/finance/revenue" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  Import revenue
                </Link>
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function FinancePageWrapper() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <FinancePage />
    </Suspense>
  );
}
