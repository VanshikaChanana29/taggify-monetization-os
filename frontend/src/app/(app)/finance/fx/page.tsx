"use client";

import { Plus } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Field, INVALID, fieldFor } from "@/components/deal/form-bits";
import { useFinanceMonth } from "@/components/finance/finance-shell";
import { Notice } from "@/components/notice";
import { useOrganization } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth, thisMonth } from "@/lib/finance";
import { HELP } from "@/lib/help";
import type { FxRate } from "@/lib/types";

function FxTab() {
  const organization = useOrganization();
  const base = organization.base_currency;
  const [month] = useFinanceMonth();
  const [rates, setRates] = useState<FxRate[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ month, currency: "USD", rate: "" });
  const [errors, setErrors] = useState<Partial<Record<"month" | "rate" | "form", string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<FxRate[]>("/fx-rates").then(setRates).catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function openFor(m: string, currency = "USD", rate = "") {
    setForm({ month: m, currency, rate });
    setErrors({});
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await api("/fx-rates", { method: "PUT", json: form });
      setOpen(false);
      setNotice(`${form.currency} rate for ${formatMonth(form.month)} saved.`);
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setErrors({ [fieldFor(message, [["closed", "month"], ["base currency", "form"], ["rate", "rate"]], "form")]: message });
    }
  }

  const months = Array.from(new Set(rates.map((r) => r.month.slice(0, 7))));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold">
            Exchange rates
            <InfoTip text={HELP.fxRate} />
          </h3>
          <p className="text-sm text-muted-foreground">
            One rate per currency per month to turn USD / AED earnings into {base}. Set it before reading a month&apos;s numbers; once the month is closed it is locked.
          </p>
        </div>
        <Button size="lg" onClick={() => openFor(month)}>
          <Plus />
          Set a rate
        </Button>
      </section>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead className="text-right">Example</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) =>
              rates
                .filter((r) => r.month.startsWith(m))
                .map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{i === 0 ? formatMonth(m) : ""}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className="font-semibold">
                      1 {r.currency} = {Number(r.rate)} {base}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {r.currency} 1,000 → {base} {(1000 * Number(r.rate)).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openFor(m, r.currency, String(Number(r.rate)))}>
                        Change
                      </Button>
                    </TableCell>
                  </TableRow>
                )),
            )}
            {rates.length === 0 && <EmptyRow colSpan={5}>No rates yet — set this month&apos;s USD rate first.</EmptyRow>}
          </TableBody>
        </Table>
      </section>

      <Dialog open={open} onClose={() => setOpen(false)} title="Set an exchange rate" description={`Used for every ${form.currency} amount in that month.`}>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field id="fx-month" label="Month *" error={errors.month}>
            <Input
              id="fx-month"
              type="month"
              required
              max={thisMonth()}
              className={errors.month ? INVALID : undefined}
              value={form.month}
              onChange={(e) => setForm({ ...form, month: e.target.value })}
            />
          </Field>
          <Field id="fx-cur" label="Currency">
            <NativeSelect id="fx-cur" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option value="USD">USD — US Dollar</option>
              <option value="AED">AED — UAE Dirham</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — Pound</option>
            </NativeSelect>
          </Field>
          <Field id="fx-rate" label={`1 ${form.currency} = ? ${base} *`} error={errors.rate} className="sm:col-span-2">
            <Input
              id="fx-rate"
              type="number"
              step="0.000001"
              min="0.000001"
              required
              placeholder="e.g. 83.50"
              className={errors.rate ? INVALID : undefined}
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
            />
          </Field>
          {form.rate && (
            <p className="rounded-xl bg-muted/50 p-3 text-sm sm:col-span-2">
              {form.currency} 25,000 earned in {form.month ? formatMonth(form.month) : "this month"} = {base}{" "}
              <span className="font-semibold">{(25000 * Number(form.rate)).toLocaleString("en-IN")}</span>
            </p>
          )}
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save rate</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default function FxPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <FxTab />
    </Suspense>
  );
}
