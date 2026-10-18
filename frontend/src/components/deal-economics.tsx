"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate, todayISO } from "@/lib/deals";
import { money } from "@/lib/finance";
import type { DealEconomics } from "@/lib/types";

/** PDF slide 11: economic recovery of the rights cost, plus installments and expenses. */
export function DealEconomicsPanel({ dealId, dealType, refreshKey }: { dealId: string; dealType: string; refreshKey: number }) {
  const [e, setE] = useState<DealEconomics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inst, setInst] = useState({ due_date: "", amount: "" });
  const [exp, setExp] = useState({ spent_on: todayISO(), amount: "", description: "" });

  const load = useCallback(() => {
    api<DealEconomics>(`/deals/${dealId}/economics`).then(setE).catch((err: Error) => setError(err.message));
  }, [dealId]);
  useEffect(load, [load, refreshKey]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (!e) return null;
  const cur = e.base_currency;
  const pct = e.recovery_pct ? Math.min(100, Math.max(0, Number(e.recovery_pct))) : 0;
  const rows: [string, string, boolean?][] = [
    ...(e.rights_cost
      ? [[dealType === "hybrid" ? "Minimum guarantee (rights cost)" : "Content rights acquisition", money(e.rights_cost, cur)] as [string, string]]
      : []),
    ["Gross revenue earned", money(e.gross, cur)],
    ["CMS commission", `−${money(e.cms_fee, cur)}`],
    ["Incentives", `−${money(e.incentives, cur)}`],
    ["Operating expenses", `−${money(e.expenses, cur)}`],
    ...(dealType === "revenue_share" ? [["Owner's revenue share", `−${money(e.owner_share, cur)}`] as [string, string]] : []),
    ...(dealType === "hybrid"
      ? [[`Owner's share above the guarantee (share earned ${money(e.royalty, cur)})`, `−${money(e.owner_share, cur)}`] as [string, string]]
      : []),
    ["Net contribution", money(e.net_contribution, cur), true],
    ...(e.remaining !== null ? [["Remaining investment to recover", money(e.remaining, cur), true] as [string, string, boolean]] : []),
  ];

  return (
    <section className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold">Profitability</h3>
        <p className="text-sm text-muted-foreground">
          Revenue counted only on days a channel held this deal&apos;s slot. Installments change cash payable, not the rights cost.
        </p>
      </div>
      {e.warnings.map((w) => (
        <p key={w} className="flex items-center gap-2 text-sm text-amber-600">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {w}
        </p>
      ))}
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableBody>
              {rows.map(([label, value, strong]) => (
                <TableRow key={label} className={strong ? "bg-muted/60 font-semibold hover:bg-muted/60" : ""}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right">{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-4">
          {e.recovery_pct !== null && (
            <div>
              <div className="flex items-end justify-between">
                <p className="font-semibold uppercase tracking-wider text-muted-foreground">Economic recovery</p>
                <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">{Number(e.recovery_pct)}%</p>
              </div>
              <div className="mt-2 h-4 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {e.by_month.length > 0 && (
            <div className="overflow-hidden rounded-xl border text-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>CMS</TableHead>
                    <TableHead>Incentives</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.by_month.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell>{m.month}</TableCell>
                      <TableCell>{money(m.gross, cur)}</TableCell>
                      <TableCell>{money(m.cms_fee, cur)}</TableCell>
                      <TableCell>{money(m.incentives, cur)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {(dealType === "fixed_fee" || dealType === "hybrid") && (
          <div>
            <h4 className="font-semibold">Installments to the content owner</h4>
            <p className="text-sm text-muted-foreground">
              Paid {money(e.paid, cur)} of {money(e.installments_total, cur)} · still payable{" "}
              <span className="font-semibold text-foreground">{money(e.payable, cur)}</span>
              {e.next_due_date && ` · next ${money(e.next_due_amount, cur)} on ${formatDate(e.next_due_date)}`}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {e.installments.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                  <span>
                    <span className="font-semibold">{money(i.amount, cur)}</span>
                    <span className="text-muted-foreground"> · due {formatDate(i.due_date)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {i.paid_on ? (
                      <Pill tone={DEAL_STATUS_TONES.active}>Paid {formatDate(i.paid_on)}</Pill>
                    ) : i.overdue ? (
                      <Pill tone={DEAL_STATUS_TONES.terminated}>Overdue</Pill>
                    ) : (
                      <Pill tone={DEAL_STATUS_TONES.expired}>Due</Pill>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        run(() =>
                          api(`/installments/${i.id}`, { method: "PATCH", json: i.paid_on ? { paid_on: null } : { paid_on: todayISO() } }),
                        )
                      }
                    >
                      {i.paid_on ? "Mark unpaid" : "Mark paid today"}
                    </Button>
                    {!i.paid_on && (
                      <Button size="icon" variant="ghost" aria-label="Delete installment" onClick={() => run(() => api(`/installments/${i.id}`, { method: "DELETE" }))}>
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                run(async () => {
                  await api(`/deals/${dealId}/installments`, { method: "POST", json: inst });
                  setInst({ due_date: "", amount: "" });
                });
              }}
            >
              <Input aria-label="Due date" type="date" required className="w-44" value={inst.due_date} onChange={(ev) => setInst({ ...inst, due_date: ev.target.value })} />
              <Input aria-label="Amount" type="number" min="0.01" step="0.01" required placeholder={`Amount (${cur})`} className="w-44" value={inst.amount} onChange={(ev) => setInst({ ...inst, amount: ev.target.value })} />
              <Button type="submit" variant="outline">
                Add installment
              </Button>
            </form>
          </div>
        )}
        <div>
          <h4 className="font-semibold">Operating expenses</h4>
          <ul className="mt-3 space-y-2 text-sm">
            {e.expense_items.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{money(x.amount, cur)}</span>
                  <span className="text-muted-foreground"> · {x.description} · {formatDate(x.spent_on)}</span>
                </span>
                <Button size="icon" variant="ghost" aria-label="Delete expense" onClick={() => run(() => api(`/expenses/${x.id}`, { method: "DELETE" }))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
            {e.expense_items.length === 0 && <li className="text-muted-foreground">None.</li>}
          </ul>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              run(async () => {
                await api(`/deals/${dealId}/expenses`, { method: "POST", json: exp });
                setExp({ spent_on: todayISO(), amount: "", description: "" });
              });
            }}
          >
            <Input aria-label="Expense date" type="date" required max={todayISO()} className="w-40" value={exp.spent_on} onChange={(ev) => setExp({ ...exp, spent_on: ev.target.value })} />
            <Input aria-label="Expense amount" type="number" min="0.01" step="0.01" required placeholder={`Amount (${cur})`} className="w-36" value={exp.amount} onChange={(ev) => setExp({ ...exp, amount: ev.target.value })} />
            <Input aria-label="Description" required placeholder="e.g. Editing" className="w-44" value={exp.description} onChange={(ev) => setExp({ ...exp, description: ev.target.value })} />
            <Button type="submit" variant="outline">
              Add expense
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
