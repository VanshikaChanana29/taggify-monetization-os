"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth, money } from "@/lib/finance";
import type { CmsMonthRow, CmsMonths } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE: Record<string, string> = { manual: "set by you", sheet: "sheet", company: "company rate" };

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A CMS month by month over a range: each month's rate, and gross, tax, CMS fee and net in
 *  the CMS's currency and in the company's, with totals and a CSV download. */
export function CmsMonthsPanel({ cmsId, month }: { cmsId: string; month: string }) {
  const [start, setStart] = useState(shift(month, -5));
  const [end, setEnd] = useState(month);
  const [data, setData] = useState<CmsMonths | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!start || !end) return;
    setError(null);
    api<CmsMonths>(`/finance/settlements/${cmsId}/months?start=${start}&end=${end}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [cmsId, start, end]);

  const cur = data?.currency ?? "USD";
  const base = data?.base_currency ?? "INR";

  function both(value: string | null, inBase: string | null, row: CmsMonthRow) {
    const showBase = cur !== base && (row.month === "total" || row.fx_rate !== null);
    return (
      <>
        {money(value, cur)}
        {showBase && <span className="block text-xs text-muted-foreground">{money(inBase, base)}</span>}
      </>
    );
  }

  function rowCells(r: CmsMonthRow) {
    const total = r.month === "total";
    return (
      <TableRow key={r.month} className={cn(total && "bg-muted/40 font-semibold hover:bg-muted/40")}>
        <TableCell className="whitespace-nowrap">{total ? "Total" : formatMonth(r.month)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">
          {total ? "" : r.fx_rate ? (
            <>
              {Number(r.fx_rate)}
              {r.fx_source && <span className="block text-xs text-muted-foreground">{SOURCE[r.fx_source]}</span>}
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">Not set</span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right">{both(r.gross, r.gross_base, r)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{both(r.tax, r.tax_base, r)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{r.fee === null ? "—" : both(r.fee, r.fee_base, r)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{r.net === null ? "—" : both(r.net, r.net_base, r)}</TableCell>
        <TableCell className="whitespace-nowrap text-right">{money(r.received, base)}</TableCell>
      </TableRow>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 p-6 pb-4">
        <div>
          <h3 className="text-lg font-semibold">Month by month</h3>
          <p className="text-sm text-muted-foreground">
            Each month&apos;s rate, and what was earned and paid in fees in {cur}
            {cur !== base ? ` and ${base}` : ""}, with the total for the months picked.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="From month" type="month" className="w-40" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input aria-label="To month" type="month" className="w-40" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/finance/settlements/${cmsId}/months.csv?start=${start}&end=${end}`} download>
              <Download />
              Download CSV
            </a>
          </Button>
        </div>
      </div>
      {error && (
        <div className="px-6 pb-4">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {data && data.months_without_rate.length > 0 && cur !== base && (
        <p className="px-6 pb-4 text-sm text-amber-700 dark:text-amber-400">
          No {cur}→{base} rate for {data.months_without_rate.map(formatMonth).join(", ")}. {base} totals leave these months out; set them under FX rates.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Tax withheld</TableHead>
            <TableHead className="text-right">CMS fee</TableHead>
            <TableHead className="text-right">Net receivable</TableHead>
            <TableHead className="text-right">Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.rows.map(rowCells)}
          {data && data.rows.length > 0 && rowCells(data.totals)}
          {data && data.rows.length === 0 && <EmptyRow colSpan={7}>No earnings in these months.</EmptyRow>}
        </TableBody>
      </Table>
    </section>
  );
}
