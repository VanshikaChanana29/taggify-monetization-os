"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Field, INVALID, fieldFor } from "@/components/deal/form-bits";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/deals";
import { formatMonth, money } from "@/lib/finance";
import type { Deal, DealEconomics } from "@/lib/types";
import { cn } from "@/lib/utils";

type Line = { label: string; value: string; hint?: string; strong?: boolean; minus?: boolean };

/** PDF slide 11: how much of the rights cost the deal has earned back. */
export function DealProfitability({ deal, e, onChange }: { deal: Deal; e: DealEconomics; onChange: () => void }) {
  const cur = e.base_currency;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ spent_on: todayISO(), amount: "", description: "" });
  const [errors, setErrors] = useState<Partial<Record<"spent_on" | "amount" | "description" | "form", string>>>({});
  const [error, setError] = useState<string | null>(null);

  const pct = e.recovery_pct === null ? null : Number(e.recovery_pct);
  const lines: Line[] = [
    { label: "Gross revenue earned", value: money(e.gross, cur), hint: "Only days a channel held this deal's slot" },
    ...(Number(e.tax) > 0
      ? [{ label: "Tax withheld", value: money(e.tax, cur), minus: true, hint: "As the CMS's sheet reports it, e.g. US tax" }]
      : []),
    { label: "CMS commission", value: money(e.cms_fee, cur), minus: true, hint: "At each CMS's rate for the month" },
    { label: "Incentives", value: money(e.incentives, cur), minus: true, hint: "Managers and team leads, on gross" },
    { label: "Operating expenses", value: money(e.expenses, cur), minus: true },
    ...(deal.deal_type === "partnership"
      ? [
          {
            label: `Partner's share (${Number(deal.revenue_share_pct)}%)`,
            value: money(e.owner_share, cur),
            minus: true,
            hint: "Of gross minus tax and CMS commission",
          },
        ]
      : deal.deal_type === "revenue_share"
      ? [{ label: "Owner's revenue share", value: money(e.owner_share, cur), minus: true }]
      : deal.deal_type === "hybrid"
        ? [
            {
              label: "Owner's share above the guarantee",
              value: money(e.owner_share, cur),
              minus: true,
              hint: `Owner's full share is ${money(e.royalty, cur)}; the guarantee covers the first part`,
            },
          ]
        : []),
    { label: "Net contribution", value: money(e.net_contribution, cur), strong: true },
  ];

  async function addExpense(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await api(`/deals/${deal.id}/expenses`, { method: "POST", json: form });
      setAdding(false);
      setForm({ spent_on: todayISO(), amount: "", description: "" });
      onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not add";
      setErrors({
        [fieldFor(message, [["date", "spent_on"], ["closed", "spent_on"], ["amount", "amount"], ["description", "description"]], "form")]: message,
      });
    }
  }

  return (
    <div className="space-y-6">
      {e.warnings
        .filter((w) => !w.startsWith("Installments add up"))
        .map((w) => (
          <Notice key={w} kind="warning">
            {w}
          </Notice>
        ))}
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid gap-6 xl:grid-cols-5">
        <section className="rounded-2xl border bg-card p-6 shadow-sm xl:col-span-2">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Economic recovery <InfoTip text={HELP.recovery} />
          </p>
          {pct === null ? (
            <p className="mt-3 text-muted-foreground">
              {deal.deal_type === "partnership"
                ? `A partnership has no rights cost. The partner gets ${Number(deal.revenue_share_pct)}% of what is left after the CMS fee; our part is the net contribution.`
                : "No rights cost on this deal, so there is nothing to recover."}
            </p>
          ) : (
            <>
              <p className="mt-3 text-5xl font-bold text-emerald-700 dark:text-emerald-400">{pct}%</p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
              </div>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{deal.deal_type === "hybrid" ? "Minimum guarantee" : "Rights cost"}</dt>
                  <dd className="font-semibold">{money(e.rights_cost, cur)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Earned back so far</dt>
                  <dd className="font-semibold">{money(e.net_contribution, cur)}</dd>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <dt className="text-muted-foreground">Still to recover</dt>
                  <dd className="font-bold">{money(e.remaining, cur)}</dd>
                </div>
              </dl>
            </>
          )}
          <p className="mt-5 text-xs text-muted-foreground">
            Recovery = net contribution ÷ rights cost. Cash paid to the owner is tracked separately under Payments.
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-3">
          <div className="p-6 pb-3">
            <h3 className="text-lg font-semibold">How the money adds up</h3>
            <p className="text-sm text-muted-foreground">All months so far, in {cur}.</p>
          </div>
          <Table>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.label} className={l.strong ? "bg-muted/60 font-semibold hover:bg-muted/60" : ""}>
                  <TableCell>
                    {l.label}
                    {l.hint && <span className="block text-xs font-normal text-muted-foreground">{l.hint}</span>}
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap text-right", l.minus && "text-muted-foreground")}>
                    {l.minus ? `− ${l.value}` : l.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-6 pb-3">
          <h3 className="text-lg font-semibold">By month</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">CMS fee</TableHead>
              <TableHead className="text-right">Incentives</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.by_month.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{formatMonth(m.month)}</TableCell>
                <TableCell className="text-right">{money(m.gross, cur)}</TableCell>
                <TableCell className="text-right">{money(m.cms_fee, cur)}</TableCell>
                <TableCell className="text-right">{money(m.incentives, cur)}</TableCell>
              </TableRow>
            ))}
            {e.by_month.length === 0 && <EmptyRow colSpan={4}>No revenue yet — import a month under CMS &amp; Finance.</EmptyRow>}
          </TableBody>
        </Table>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-3">
          <div>
            <h3 className="text-lg font-semibold">
              Operating expenses <InfoTip text={HELP.expenses} />
            </h3>
            <p className="text-sm text-muted-foreground">Editing, promotion and other costs charged to this deal.</p>
          </div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus />
            Add expense
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>What for</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.expense_items.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="whitespace-nowrap">{formatDate(x.spent_on)}</TableCell>
                <TableCell>{x.description}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{money(x.amount, cur)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete expense ${x.description}`}
                    onClick={async () => {
                      if (!window.confirm("Delete this expense?")) return;
                      try {
                        await api(`/expenses/${x.id}`, { method: "DELETE" });
                        onChange();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not delete");
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {e.expense_items.length === 0 && <EmptyRow colSpan={4}>No expenses recorded.</EmptyRow>}
          </TableBody>
        </Table>
      </section>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add expense" description={`Charged to ${deal.title}, in ${cur}.`}>
        <form onSubmit={addExpense} className="grid gap-4 sm:grid-cols-2">
          <Field id="ex-date" label="Date *" error={errors.spent_on}>
            <Input
              id="ex-date"
              type="date"
              required
              max={todayISO()}
              className={errors.spent_on ? INVALID : undefined}
              value={form.spent_on}
              onChange={(ev) => setForm({ ...form, spent_on: ev.target.value })}
            />
          </Field>
          <Field id="ex-amount" label={`Amount (${cur}) *`} error={errors.amount}>
            <Input
              id="ex-amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              className={errors.amount ? INVALID : undefined}
              value={form.amount}
              onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
            />
          </Field>
          <Field id="ex-desc" label="What for *" error={errors.description} className="sm:col-span-2">
            <Input
              id="ex-desc"
              required
              maxLength={300}
              placeholder="e.g. Clip editing — September"
              className={errors.description ? INVALID : undefined}
              value={form.description}
              onChange={(ev) => setForm({ ...form, description: ev.target.value })}
            />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit">Add expense</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

