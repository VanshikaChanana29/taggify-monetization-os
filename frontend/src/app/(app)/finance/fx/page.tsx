"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { useOrganization } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth, shiftMonth, thisMonth } from "@/lib/finance";
import type { FxRate } from "@/lib/types";

export default function FxPage() {
  const organization = useOrganization();
  const [rates, setRates] = useState<FxRate[]>([]);
  const [form, setForm] = useState({ month: shiftMonth(thisMonth(), -1), currency: "USD", rate: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<FxRate[]>("/fx-rates").then(setRates).catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api("/fx-rates", { method: "PUT", json: form });
      setNotice(`${form.currency} rate for ${formatMonth(form.month)} saved.`);
      setForm({ ...form, rate: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <div className="space-y-8">
      <Link href="/finance" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        CMS & Finance
      </Link>
      <PageHeader
        title="FX rates"
        description={`One rate per currency per month, to convert CMS earnings into ${organization.base_currency}. Changing a rate re-prices that month.`}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <Label htmlFor="fx-month">Month</Label>
          <Input id="fx-month" type="month" required max={thisMonth()} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fx-cur">Currency</Label>
          <NativeSelect id="fx-cur" className="w-32" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="USD">USD</option>
            <option value="AED">AED</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="fx-rate">1 {form.currency} = ? {organization.base_currency}</Label>
          <Input id="fx-rate" type="number" step="0.000001" min="0.000001" required placeholder="84.00" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
        </div>
        <Button type="submit">Save rate</Button>
      </form>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{formatMonth(r.month)}</TableCell>
                <TableCell>{r.currency}</TableCell>
                <TableCell>
                  1 {r.currency} = {Number(r.rate)} {organization.base_currency}
                </TableCell>
              </TableRow>
            ))}
            {rates.length === 0 && <EmptyRow colSpan={3}>No rates yet.</EmptyRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
