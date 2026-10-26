"use client";

import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { PartnerForm } from "@/components/partner-form";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate, todayISO } from "@/lib/deals";
import { compactInr, formatMonth, money } from "@/lib/finance";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { PartnerDetail, PartnerMonth } from "@/lib/types";

type Tab = "statement" | "channels" | "deals" | "payments";
const TABS: Tab[] = ["statement", "channels", "deals", "payments"];

const STATUS: Record<PartnerMonth["status"], { label: string; tone: string }> = {
  waiting_cms: { label: "Waiting for CMS", tone: DEAL_STATUS_TONES.expired },
  due: { label: "To pay", tone: DEAL_STATUS_TONES.draft },
  part_paid: { label: "Part paid", tone: DEAL_STATUS_TONES.draft },
  paid: { label: "Paid", tone: DEAL_STATUS_TONES.active },
  needs_rate: { label: "Needs FX rate", tone: DEAL_STATUS_TONES.terminated },
  needs_slabs: { label: "Needs CMS slabs", tone: DEAL_STATUS_TONES.terminated },
};

function PartnerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "statement";
  const [data, setData] = useState<PartnerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pay, setPay] = useState<{ month: string; amount: string; tds_amount: string; paid_on: string; reference: string } | null>(null);
  const [money_in, setMoneyIn] = useState<{ deal_id: string; amount: string; received_on: string; reference: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PartnerDetail>(`/partners/${id}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  function go(next: Tab) {
    router.replace(`/partners/${id}${next === "statement" ? "" : `?tab=${next}`}`, { scroll: false });
  }

  async function send(path: string, json: unknown, message: string, close: () => void) {
    setFormError(null);
    try {
      await api(path, { method: "POST", json });
      close();
      setNotice(message);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function remove(path: string, message: string) {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await api(path, { method: "DELETE" });
      setNotice(message);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!data) return error ? <Notice kind="error">{error}</Notice> : <PageLoader />;
  const p = data.partner;
  const base = data.base_currency;
  const licenceOwed = data.deals.reduce((t, d) => t + Math.max(0, Number(d.contribution_due ?? 0)), 0);
  const facts: [string, string, string?][] = [
    ["Still to pay", compactInr(p.outstanding), "CMS has paid us for these months"],
    ["After the CMS pays", compactInr(p.waiting), "Earned, but the CMS has not paid us yet"],
    ["Paid so far", compactInr(p.paid)],
    ["Earned in all", compactInr(p.earned), "Their channels, after the CMS fee"],
    ["Licence money still owed to us", compactInr(licenceOwed), "Their % of the licence fee, less what they paid in"],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/partners">
            <ArrowLeft /> All partners
          </Link>
        </Button>
      </div>

      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"} · TDS{" "}
              {p.tds_pct === null ? "not set" : `${Number(p.tds_pct)}%`} ·{" "}
              {p.deals.map((d) => `${d.title} ${Number(d.share_pct)}%`).join(", ") || "not on a deal yet"}
            </p>
          </div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {facts.map(([k, v, hint], i) => (
            <div
              key={k}
              className={
                i === 0
                  ? "rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10"
                  : "rounded-xl border bg-muted/30 px-3 py-2"
              }
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd className="text-lg font-bold tabular-nums">{v}</dd>
              {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </div>
          ))}
        </dl>
        {data.warnings.map((w) => (
          <p key={w} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
          </p>
        ))}
      </section>

      <Tabs
        value={tab}
        onChange={go}
        tabs={[
          { key: "statement", label: "Monthly statement", count: data.months.length, alert: Number(p.outstanding) > 0 },
          { key: "channels", label: "Channels", count: data.channels.length },
          { key: "deals", label: "Deals & licence", count: data.deals.length, alert: licenceOwed > 0 },
          { key: "payments", label: "Payments", count: data.payouts.length },
        ]}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {tab === "statement" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="p-5 pb-3">
            <h3 className="text-lg font-semibold">What {p.name} earns, month by month</h3>
            <p className="text-sm text-muted-foreground">
              Their channels&apos; earnings after the CMS fee. A month becomes payable once the CMS has paid you for it; TDS is taken off.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">CMS fee &amp; tax</TableHead>
                <TableHead className="text-right">Their share</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead className="text-right">To pay</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.months.map((m) => {
                const cur = m.currency ?? "USD";
                const payable = m.status === "due" || m.status === "part_paid";
                return (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">
                      {formatMonth(m.month)}
                      <span className="block text-xs text-muted-foreground">{m.channels} channel(s)</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(m.gross, cur)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">−{money(Number(m.cms_fee) + Number(m.tax), cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(m.share, cur)}
                      {m.share_base !== null && cur !== base && (
                        <span className="block text-xs text-muted-foreground">{money(m.share_base, base)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{m.tds === null ? "—" : `−${money(m.tds, base)}`}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{m.to_pay === null ? "—" : money(m.to_pay, base)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{money(m.paid, base)}</TableCell>
                    <TableCell>
                      <Pill tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Pill>
                    </TableCell>
                    <TableCell className="text-right">
                      {payable && m.balance !== null && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setFormError(null);
                            setPay({
                              month: m.month,
                              amount: String(Number(m.balance)),
                              tds_amount: String(Math.max(0, Number(m.tds ?? 0) - Number(m.tds_paid))),
                              paid_on: todayISO(),
                              reference: "",
                            });
                          }}
                        >
                          Record payment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {data.months.length === 0 && <EmptyRow colSpan={9}>No earnings yet — mark their channels as theirs (Channels tab).</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      {tab === "channels" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
            <div>
              <h3 className="text-lg font-semibold">{p.name}&apos;s channels</h3>
              <p className="text-sm text-muted-foreground">
                To add one: open the channel → Edit → <b>Owned by partner</b>, or use the <b>Partner</b> column in Channels → Import channels.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/channels">Go to Channels</Link>
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No.</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Channel ID</TableHead>
                <TableHead>CMS</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.channels.map((c, idx) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/channels/${c.id}`)}>
                  <TableCell className="w-14 tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <p className="font-medium text-primary">{c.name}</p>
                    <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{c.external_id}</TableCell>
                  <TableCell>{c.cms_name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{c.status}</TableCell>
                </TableRow>
              ))}
              {data.channels.length === 0 && <EmptyRow colSpan={5}>No channels marked as {p.name}&apos;s yet.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      {tab === "deals" && (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
              <div>
                <h3 className="text-lg font-semibold">Their share of each licence</h3>
                <p className="text-sm text-muted-foreground">They pay you their % of the licence fee. Set the % on the deal (Deal → Partners tab).</p>
              </div>
              {data.deals.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    setFormError(null);
                    setMoneyIn({ deal_id: data.deals[0].deal_id, amount: "", received_on: todayISO(), reference: "" });
                  }}
                >
                  <Plus /> Record money received
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead className="text-right">Their %</TableHead>
                  <TableHead className="text-right">Their part of the licence</TableHead>
                  <TableHead className="text-right">Paid to us</TableHead>
                  <TableHead className="text-right">Still owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deals.map((d) => (
                  <TableRow key={d.deal_id} className="cursor-pointer" onClick={() => router.push(`/deals/${d.deal_id}?tab=partners`)}>
                    <TableCell>
                      <p className="font-medium text-primary">{d.title}</p>
                      <p className="text-xs text-muted-foreground">{d.owner}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(d.share_pct)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{d.licence_share === null ? "—" : money(d.licence_share, base)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{money(d.contributed, base)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {d.contribution_due === null ? "—" : money(Math.max(0, Number(d.contribution_due)), base)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.deals.length === 0 && <EmptyRow colSpan={5}>Not on any deal yet — open a deal → Partners tab.</EmptyRow>}
              </TableBody>
            </Table>
          </section>
          {data.contributions.length > 0 && (
            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="p-5 pb-3">
                <h3 className="text-lg font-semibold">Money received from {p.name}</h3>
              </div>
              <Table>
                <TableBody>
                  {data.contributions.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{formatDate(c.received_on)}</TableCell>
                      <TableCell>{c.deal_title}</TableCell>
                      <TableCell className="text-muted-foreground">{c.reference ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(c.amount, base)}</TableCell>
                      <TableCell className="w-12 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete"
                          onClick={() => remove(`/partner-contributions/${c.id}`, "Entry deleted.")}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </div>
      )}

      {tab === "payments" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="p-5 pb-3">
            <h3 className="text-lg font-semibold">Payments to {p.name}</h3>
            <p className="text-sm text-muted-foreground">Record a payment from the Monthly statement tab (Record payment on a month).</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paid on</TableHead>
                <TableHead>For month</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">TDS kept</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payouts.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>{formatDate(x.paid_on)}</TableCell>
                  <TableCell>{formatMonth(x.month)}</TableCell>
                  <TableCell className="text-muted-foreground">{x.reference ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{money(x.tds_amount, base)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(x.amount, base)}</TableCell>
                  <TableCell className="w-12 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete payment"
                      onClick={() => remove(`/partner-payouts/${x.id}`, "Payment deleted.")}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.payouts.length === 0 && <EmptyRow colSpan={6}>Nothing paid yet.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} wide title={`Edit ${p.name}`}>
        {editing && (
          <PartnerForm
            partner={p}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setNotice("Saved.");
              load();
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={pay !== null}
        onClose={() => setPay(null)}
        title={`Pay ${p.name}`}
        description={pay ? `For ${formatMonth(pay.month)}'s earnings, in ${base}.` : undefined}
      >
        {pay && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(`/partners/${id}/payouts`, { ...pay, reference: pay.reference || null }, "Payment recorded.", () => setPay(null));
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="po-amount">Amount paid ({base}) *</Label>
              <Input
                id="po-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={pay.amount}
                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="po-tds">TDS kept ({base})</Label>
              <Input
                id="po-tds"
                type="number"
                step="0.01"
                min="0"
                value={pay.tds_amount}
                onChange={(e) => setPay({ ...pay, tds_amount: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="po-date">Paid on *</Label>
              <Input
                id="po-date"
                type="date"
                max={todayISO()}
                required
                value={pay.paid_on}
                onChange={(e) => setPay({ ...pay, paid_on: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="po-ref">Bank reference (UTR)</Label>
              <Input id="po-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </div>
            {formError && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{formError}</p>}
            <div className="sm:col-span-2">
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPay(null)}>
                  Cancel
                </Button>
                <Button type="submit">Record payment</Button>
              </DialogFooter>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={money_in !== null}
        onClose={() => setMoneyIn(null)}
        title={`Money received from ${p.name}`}
        description="Their part of a licence fee, paid to you."
      >
        {money_in && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(`/partners/${id}/contributions`, { ...money_in, reference: money_in.reference || null }, "Money received recorded.", () =>
                setMoneyIn(null),
              );
            }}
          >
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ci-deal">Deal *</Label>
              <NativeSelect id="ci-deal" value={money_in.deal_id} onChange={(e) => setMoneyIn({ ...money_in, deal_id: e.target.value })}>
                {data.deals.map((d) => (
                  <option key={d.deal_id} value={d.deal_id}>
                    {d.title} ({Number(d.share_pct)}%)
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ci-amount">Amount ({base}) *</Label>
              <Input
                id="ci-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={money_in.amount}
                onChange={(e) => setMoneyIn({ ...money_in, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ci-date">Received on *</Label>
              <Input
                id="ci-date"
                type="date"
                max={todayISO()}
                required
                value={money_in.received_on}
                onChange={(e) => setMoneyIn({ ...money_in, received_on: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ci-ref">Reference</Label>
              <Input id="ci-ref" value={money_in.reference} onChange={(e) => setMoneyIn({ ...money_in, reference: e.target.value })} />
            </div>
            {formError && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{formError}</p>}
            <div className="sm:col-span-2">
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMoneyIn(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

export default function PartnerDetailPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PartnerPage />
    </Suspense>
  );
}
