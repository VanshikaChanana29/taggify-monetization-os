"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, Plus, Trash2, Wallet } from "lucide-react";
import { useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Field, INVALID, TEXTAREA, daysBetween, fieldFor } from "@/components/deal/form-bits";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate, todayISO } from "@/lib/deals";
import { money } from "@/lib/finance";
import type { Deal, DealEconomics, Installment } from "@/lib/types";

type NewForm = { due_date: string; amount: string; reference: string; notes: string };
type PaidForm = { paid_on: string; paid_amount: string; reference: string };
type Errors = Partial<Record<"due_date" | "amount" | "paid_on" | "paid_amount" | "form", string>>;

function statusOf(i: Installment, today: string) {
  if (i.paid_on) return { label: `Paid ${formatDate(i.paid_on)}`, tone: DEAL_STATUS_TONES.active };
  const days = daysBetween(today, i.due_date);
  if (days < 0) return { label: `Overdue · ${-days} day${days === -1 ? "" : "s"}`, tone: DEAL_STATUS_TONES.terminated };
  if (days === 0) return { label: "Due today", tone: DEAL_STATUS_TONES.draft };
  return { label: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: days <= 30 ? DEAL_STATUS_TONES.draft : DEAL_STATUS_TONES.upcoming };
}

/** What Taggify owes the content owner and when (PDF slide 11: cash payable, not the rights cost). */
export function DealPayments({ deal, e, onChange }: { deal: Deal; e: DealEconomics; onChange: () => void }) {
  const cur = e.base_currency;
  const today = todayISO();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewForm>({ due_date: "", amount: "", reference: "", notes: "" });
  const [paying, setPaying] = useState<Installment | null>(null);
  const [paid, setPaid] = useState<PaidForm>({ paid_on: today, paid_amount: "", reference: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (deal.deal_type !== "fixed_fee" && deal.deal_type !== "hybrid") {
    return (
      <Notice kind="info">
        This is a {deal.deal_type === "owned" ? "company-owned" : "revenue-share"} deal, so there is no licence fee to pay in
        installments. The owner&apos;s share is shown under Profitability.
      </Notice>
    );
  }

  const feeLabel = deal.deal_type === "hybrid" ? "Minimum guarantee" : "Licence fee";
  const overdue = e.installments.filter((i) => i.overdue);
  const mismatch = e.warnings.find((w) => w.startsWith("Installments add up"));
  const remainingToPlan = Number(deal.fee_amount ?? 0) - Number(e.installments_total);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setSaving(true);
    try {
      await api(`/deals/${deal.id}/installments`, {
        method: "POST",
        json: { due_date: form.due_date, amount: form.amount, reference: form.reference || null, notes: form.notes || null },
      });
      setAdding(false);
      setForm({ due_date: "", amount: "", reference: "", notes: "" });
      onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not add";
      setErrors({ [fieldFor(message, [["date", "due_date"], ["amount", "amount"]], "form")]: message });
    } finally {
      setSaving(false);
    }
  }

  function openPay(i: Installment) {
    setPaying(i);
    setPaid({ paid_on: today, paid_amount: String(Number(i.amount)), reference: "" });
    setErrors({});
  }

  async function markPaid(event: React.FormEvent) {
    event.preventDefault();
    if (!paying) return;
    setErrors({});
    setSaving(true);
    try {
      await api(`/installments/${paying.id}`, {
        method: "PATCH",
        json: { paid_on: paid.paid_on, paid_amount: paid.paid_amount || null, reference: paid.reference || null },
      });
      setPaying(null);
      onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setErrors({ [fieldFor(message, [["date", "paid_on"], ["future", "paid_on"], ["amount", "paid_amount"]], "form")]: message });
    } finally {
      setSaving(false);
    }
  }

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={feeLabel} value={money(deal.fee_amount, deal.currency)} icon={Wallet} tone="slate" />
        <StatCard label="Paid so far" value={money(e.paid, cur)} icon={CheckCircle2} tone="green" />
        <StatCard
          label="Still payable"
          value={money(e.payable, cur)}
          icon={CalendarClock}
          tone={Number(e.payable) > 0 ? "amber" : "green"}
          hint={remainingToPlan > 0 ? <span>{money(remainingToPlan, cur)} of the fee has no installment yet</span> : undefined}
        />
        <StatCard
          label="Next payment"
          value={e.next_due_amount ? money(e.next_due_amount, cur) : "—"}
          icon={AlertTriangle}
          tone={overdue.length ? "amber" : "slate"}
          hint={
            e.next_due_date ? (
              <span className={overdue.length ? "font-semibold text-red-600 dark:text-red-400" : undefined}>
                {overdue.length ? `Overdue since ${formatDate(e.next_due_date)}` : `Due ${formatDate(e.next_due_date)}`}
              </span>
            ) : (
              <span>Nothing due</span>
            )
          }
        />
      </div>

      {mismatch && <Notice kind="warning">{mismatch} Add or correct installments so they match the {feeLabel.toLowerCase()}.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Installments to {deal.owner_name}</h3>
            <p className="text-sm text-muted-foreground">
              Paying an installment reduces what is still payable — it never adds to the rights cost (PDF slide 11).
            </p>
          </div>
          <Button
            onClick={() => {
              setAdding(true);
              setErrors({});
              if (remainingToPlan > 0) setForm((f) => ({ ...f, amount: f.amount || String(remainingToPlan) }));
            }}
          >
            <Plus />
            Add installment
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment details</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.installments.map((i, n) => {
              const s = statusOf(i, today);
              return (
                <TableRow key={i.id}>
                  <TableCell className="text-muted-foreground">{n + 1}</TableCell>
                  <TableCell className="whitespace-nowrap font-medium">{formatDate(i.due_date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{money(i.amount, cur)}</TableCell>
                  <TableCell>
                    <Pill tone={s.tone}>{s.label}</Pill>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {i.paid_on ? (
                      <>
                        {i.paid_amount && Number(i.paid_amount) !== Number(i.amount) && <span className="block">Paid {money(i.paid_amount, cur)}</span>}
                        {i.reference ?? "—"}
                      </>
                    ) : (
                      (i.notes ?? "—")
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {i.paid_on ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          window.confirm("Mark this installment as not paid?") &&
                          act(() => api(`/installments/${i.id}`, { method: "PATCH", json: { paid_on: null } }))
                        }
                      >
                        Mark unpaid
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => openPay(i)}>
                          Mark paid
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete installment ${n + 1}`}
                          onClick={() =>
                            window.confirm("Delete this installment?") && act(() => api(`/installments/${i.id}`, { method: "DELETE" }))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {e.installments.length === 0 && (
              <EmptyRow colSpan={6}>No payment plan yet — add the installments from the contract (e.g. on signing, month 2, month 4).</EmptyRow>
            )}
          </TableBody>
          {e.installments.length > 0 && (
            <tfoot>
              <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell />
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{money(e.installments_total, cur)}</TableCell>
                <TableCell colSpan={3} className="text-sm font-normal text-muted-foreground">
                  Paid {money(e.paid, cur)} · still payable {money(e.payable, cur)}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </section>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add installment" description={`A payment due to ${deal.owner_name}, in ${cur}.`}>
        <form onSubmit={add} className="grid gap-4 sm:grid-cols-2">
          <Field id="in-due" label="Due date *" error={errors.due_date}>
            <Input
              id="in-due"
              type="date"
              required
              className={errors.due_date ? INVALID : undefined}
              value={form.due_date}
              onChange={(ev) => setForm({ ...form, due_date: ev.target.value })}
            />
          </Field>
          <Field id="in-amount" label={`Amount (${cur}) *`} error={errors.amount}>
            <Input
              id="in-amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              className={errors.amount ? INVALID : undefined}
              value={form.amount}
              onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
            />
          </Field>
          <Field id="in-ref" label="Invoice / reference" className="sm:col-span-2">
            <Input id="in-ref" placeholder="e.g. Sony invoice 2026/014" value={form.reference} onChange={(ev) => setForm({ ...form, reference: ev.target.value })} />
          </Field>
          <Field id="in-notes" label="Note" className="sm:col-span-2">
            <textarea id="in-notes" rows={2} className={TEXTAREA} placeholder="e.g. On signing" value={form.notes} onChange={(ev) => setForm({ ...form, notes: ev.target.value })} />
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
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Add installment"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={paying !== null}
        onClose={() => setPaying(null)}
        title="Mark installment paid"
        description={paying ? `${money(paying.amount, cur)} due ${formatDate(paying.due_date)}` : undefined}
      >
        <form onSubmit={markPaid} className="grid gap-4 sm:grid-cols-2">
          <Field id="pd-on" label="Paid on *" error={errors.paid_on}>
            <Input
              id="pd-on"
              type="date"
              required
              max={today}
              className={errors.paid_on ? INVALID : undefined}
              value={paid.paid_on}
              onChange={(ev) => setPaid({ ...paid, paid_on: ev.target.value })}
            />
          </Field>
          <Field id="pd-amount" label={`Amount paid (${cur})`} error={errors.paid_amount} hint="Change only if a different amount was paid.">
            <Input
              id="pd-amount"
              type="number"
              min="0.01"
              step="0.01"
              className={errors.paid_amount ? INVALID : undefined}
              value={paid.paid_amount}
              onChange={(ev) => setPaid({ ...paid, paid_amount: ev.target.value })}
            />
          </Field>
          <Field id="pd-ref" label="Bank reference (UTR)" className="sm:col-span-2">
            <Input id="pd-ref" placeholder="e.g. UTR 1234567890" value={paid.reference} onChange={(ev) => setPaid({ ...paid, reference: ev.target.value })} />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaying(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Mark paid"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
