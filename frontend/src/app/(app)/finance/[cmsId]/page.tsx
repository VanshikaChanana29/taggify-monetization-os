"use client";

import { AlertTriangle, ChevronRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Field, INVALID, fieldFor } from "@/components/deal/form-bits";
import { useFinanceMonth } from "@/components/finance/finance-shell";
import { MoneyFlow } from "@/components/finance/money-flow";
import { StatementTab } from "@/components/finance/statement-tab";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate, todayISO } from "@/lib/deals";
import { formatMonth, money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import { HELP } from "@/lib/help";
import type { CmsMonthDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageLoader } from "@/components/loader";

type Tab = "channels" | "statement" | "cash" | "adjustments";
const TABS: Tab[] = ["channels", "statement", "cash", "adjustments"];
type Errors = Partial<Record<string, string>>;

function CmsMonthPage() {
  const { cmsId } = useParams<{ cmsId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const [month] = useFinanceMonth();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "channels";

  const [data, setData] = useState<CmsMonthDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [dialog, setDialog] = useState<"receipt" | "adjustment" | null>(null);
  const [receipt, setReceipt] = useState({ currency: "", amount: "", amount_base: "", received_on: todayISO(), reference: "" });
  const [adjustment, setAdjustment] = useState({ direction: "-1", amount: "", reason: "" });

  const load = useCallback(() => {
    api<CmsMonthDetail>(`/finance/settlements/${cmsId}?month=${month}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [cmsId, month]);
  useEffect(load, [load]);

  function go(next: Tab) {
    router.replace(`/finance/${cmsId}?month=${month}${next === "channels" ? "" : `&tab=${next}`}`, { scroll: false });
  }

  async function submit(action: () => Promise<unknown>, message: string, rules: [string, string][]) {
    setErrors({});
    try {
      await action();
      setDialog(null);
      setNotice(message);
      setError(null);
      load();
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong";
      setErrors({ [fieldFor(text, rules, "form")]: text });
    }
  }

  async function remove(path: string, message: string) {
    setError(null);
    try {
      await api(path, { method: "DELETE" });
      setNotice(message);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!data) return error ? <Notice kind="error">{error}</Notice> : <PageLoader />;
  const s = data.summary;
  const cur = s.currency ?? "USD";
  const base = data.base_currency;
  const hasCms = cmsId !== "none";
  const hasTax = Number(s.tax) > 0;
  const payCurrencies = Array.from(new Set([cur, "USD", "AED", base]));
  const payCurrency = receipt.currency || payCurrencies[0];
  const preview =
    payCurrency === cur && s.fx_rate && receipt.amount && cur !== base ? Number(receipt.amount) * Number(s.fx_rate) : null;
  const fxGap = preview !== null && receipt.amount_base ? Number(receipt.amount_base) - preview : null;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={`/finance?month=${month}`} className="hover:text-primary">
          Overview
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-foreground">
          {s.cms_name} · {formatMonth(month)}
        </span>
      </nav>

      <section className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{s.cms_name}</h2>
            <p className="text-sm text-muted-foreground">
              {s.channel_count} channel{s.channel_count === 1 ? "" : "s"}
              {s.fee_rule ? ` · Fee: ${s.fee_rule}` : hasCms ? " · No fee tiers for this month" : " · Channels without a CMS"}
              {s.fx_rate && cur !== base ? ` · 1 ${cur} = ${Number(s.fx_rate)} ${base}` : ""}
            </p>
          </div>
          {hasCms && (
            <Button variant="outline" asChild>
              <Link href={`/cms-partners/${cmsId}`}>Fee tiers & contract</Link>
            </Button>
          )}
        </div>
        {s.warnings.map((w) => (
          <p key={w} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {w}
            {w.includes("fee schedule") && hasCms && (
              <Link href={`/cms-partners/${cmsId}`} className="ml-auto font-semibold underline">
                Add fee tiers
              </Link>
            )}
            {w.includes("rate") && (
              <Link href="/finance/fx" className="ml-auto font-semibold underline">
                Set FX rate
              </Link>
            )}
          </p>
        ))}
        <MoneyFlow
          steps={[
            { label: "Gross", value: money(s.gross, cur), info: HELP.grossRevenue, sub: "All its channels together" },
            ...(hasTax
              ? [{ label: "Tax withheld", value: money(s.tax, cur), op: "−", tone: "minus" as const, info: HELP.taxWithheld }]
              : []),
            { label: "CMS fee", value: s.fee === null ? "—" : money(s.fee, cur), op: "−", tone: "minus", info: HELP.feeTiers },
            {
              label: "Net due",
              value: s.net === null ? "—" : money(s.net, cur),
              op: "=",
              info: HELP.netReceivable,
              sub: cur !== base && s.net_base ? `${money(s.net_base, base)} at the month's rate` : undefined,
            },
            {
              label: "Received",
              value: money(s.received, base),
              op: "−",
              tone: "minus",
              info: HELP.cashReceived,
              sub: Number(s.adjustments) ? `Adjustments ${money(s.adjustments, base)}` : undefined,
            },
            {
              label: "Outstanding",
              value: hasCms ? money(s.outstanding, base) : "—",
              op: "=",
              tone: Number(s.outstanding ?? 0) > 0 ? "warn" : "result",
              info: HELP.outstanding,
            },
          ]}
        />
      </section>

      <Tabs
        value={tab}
        onChange={go}
        tabs={[
          { key: "channels", label: "Channels", count: data.channels.length },
          ...(hasCms
            ? [
                { key: "statement" as Tab, label: "Statement", alert: s.variance !== null && Number(s.variance) !== 0 },
                { key: "cash" as Tab, label: "Cash received", count: data.receipts.length },
                { key: "adjustments" as Tab, label: "Adjustments", count: data.adjustments.length },
              ]
            : []),
        ]}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {tab === "channels" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Channels under {s.cms_name}</h3>
            <p className="text-sm text-muted-foreground">
              The fee is worked out on all of them together, then shared out by each channel&apos;s gross
              {hasTax ? " after tax" : ""} (PDF slide 9).
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Content deal</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                {hasTax && <TableHead className="text-right">Tax</TableHead>}
                <TableHead className="text-right">Fee share</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.channels.map((c) => (
                <TableRow key={c.channel_id}>
                  <TableCell>
                    <Link href={`/channels/${c.channel_id}`} className="font-medium hover:text-primary">
                      {c.channel_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.deals.join(", ") || "—"}</TableCell>
                  <TableCell className="text-right">{c.views?.toLocaleString("en-IN") ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{money(c.gross, cur)}</TableCell>
                  {hasTax && <TableCell className="text-right">{money(c.tax, cur)}</TableCell>}
                  <TableCell className="text-right">{c.fee_share === null ? "—" : money(c.fee_share, cur)}</TableCell>
                  <TableCell className="text-right">{c.net_share === null ? "—" : money(c.net_share, cur)}</TableCell>
                </TableRow>
              ))}
              {data.channels.length === 0 && <EmptyRow colSpan={hasTax ? 7 : 6}>No revenue imported for this CMS in {formatMonth(month)}.</EmptyRow>}
            </TableBody>
            {data.channels.length > 0 && (
              <tfoot>
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell>Total</TableCell>
                  <TableCell>{data.channels.length} channel(s)</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{money(s.gross, cur)}</TableCell>
                  {hasTax && <TableCell className="text-right">{money(s.tax, cur)}</TableCell>}
                  <TableCell className="text-right">{s.fee === null ? "—" : money(s.fee, cur)}</TableCell>
                  <TableCell className="text-right">{s.net === null ? "—" : money(s.net, cur)}</TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        </section>
      )}

      {tab === "statement" && hasCms && (
        <StatementTab
          cmsId={cmsId}
          month={month}
          summary={s}
          statement={data.statement}
          reconciliation={data.reconciliation}
          onSaved={(message) => {
            setNotice(message);
            setError(null);
            load();
          }}
        />
      )}

      {tab === "cash" && hasCms && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
            <div>
              <h3 className="text-lg font-semibold">
                Money received from {s.cms_name}
                <InfoTip text={HELP.receiptCurrency} />
              </h3>
              <p className="text-sm text-muted-foreground">For {formatMonth(month)}&apos;s earnings. Each payment clears the balance at the month&apos;s rate.</p>
            </div>
            <Button
              onClick={() => {
                setReceipt({ currency: "", amount: "", amount_base: "", received_on: todayISO(), reference: "" });
                setErrors({});
                setDialog("receipt");
              }}
            >
              <Plus />
              Record payment
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received on</TableHead>
                <TableHead className="text-right">They paid</TableHead>
                <TableHead className="text-right">Bank credited</TableHead>
                <TableHead className="text-right">Clears</TableHead>
                <TableHead className="text-right">
                  FX gain / loss
                  <InfoTip text={HELP.fxDifference} />
                </TableHead>
                <TableHead>Reference</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.receipts.map((r) => {
                const fx = r.valued_base !== null && r.currency !== base ? Number(r.amount_base) - Number(r.valued_base) : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.received_on)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{money(r.amount, r.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{money(r.amount_base, base)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{money(r.valued_base ?? r.amount_base, base)}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right", fx > 0 && "text-emerald-600", fx < 0 && "text-red-600")}>
                      {fx === 0 ? "—" : money(fx, base)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.reference ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete payment"
                        onClick={() => window.confirm("Delete this payment?") && remove(`/finance/receipts/${r.id}`, "Payment deleted.")}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {data.receipts.length === 0 && <EmptyRow colSpan={7}>Nothing received yet for {formatMonth(month)}.</EmptyRow>}
            </TableBody>
            {data.receipts.length > 0 && (
              <tfoot>
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{money(s.received_credited, base)}</TableCell>
                  <TableCell className="text-right">{money(s.received, base)}</TableCell>
                  <TableCell className="text-right">{Number(s.fx_difference) ? money(s.fx_difference, base) : "—"}</TableCell>
                  <TableCell colSpan={2} className="font-normal text-muted-foreground">
                    Outstanding {money(s.outstanding, base)}
                  </TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        </section>
      )}

      {tab === "adjustments" && hasCms && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
            <div>
              <h3 className="text-lg font-semibold">
                Adjustments
                <InfoTip text={HELP.adjustment} />
              </h3>
              <p className="text-sm text-muted-foreground">Tax withheld, chargebacks, disputes, late revisions — anything that changes what {s.cms_name} owes.</p>
            </div>
            <Button
              onClick={() => {
                setAdjustment({ direction: "-1", amount: "", reason: "" });
                setErrors({});
                setDialog("adjustment");
              }}
            >
              <Plus />
              Add adjustment
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Added</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Effect</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.adjustments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                  <TableCell>{a.reason}</TableCell>
                  <TableCell>
                    <Pill tone={Number(a.amount) < 0 ? DEAL_STATUS_TONES.terminated : DEAL_STATUS_TONES.active}>
                      {Number(a.amount) < 0 ? "Reduces what they owe" : "Increases what they owe"}
                    </Pill>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{money(a.amount, base)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete adjustment"
                      onClick={() => window.confirm("Delete this adjustment?") && remove(`/finance/adjustments/${a.id}`, "Adjustment deleted.")}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.adjustments.length === 0 && <EmptyRow colSpan={5}>No adjustments.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      {/* ---- Popups ---------------------------------------------------------------------- */}
      <Dialog
        open={dialog === "receipt"}
        onClose={() => setDialog(null)}
        title={`Record a payment from ${s.cms_name}`}
        description={`For ${formatMonth(month)}'s earnings. Check your bank statement for the amount credited.`}
      >
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                api("/finance/receipts", {
                  method: "POST",
                  json: {
                    cms_partner_id: cmsId,
                    month,
                    currency: payCurrency,
                    amount: receipt.amount,
                    amount_base: payCurrency === base ? null : receipt.amount_base,
                    received_on: receipt.received_on,
                    reference: receipt.reference || null,
                  },
                }),
              "Payment recorded.",
              [["credited", "amount_base"], ["future", "received_on"], ["date", "received_on"], ["amount", "amount"]],
            );
          }}
        >
          <Field id="rc-currency" label="They paid in">
            <NativeSelect id="rc-currency" value={payCurrency} onChange={(e) => setReceipt({ ...receipt, currency: e.target.value })}>
              {payCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rc-amount" label={`Amount (${payCurrency}) *`} error={errors.amount}>
            <Input id="rc-amount" type="number" step="0.01" min="0.01" required className={errors.amount ? INVALID : undefined} value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} />
          </Field>
          {payCurrency !== base && (
            <Field id="rc-base" label={`Bank credited (${base}) *`} error={errors.amount_base} hint="Exactly what reached your bank account." className="sm:col-span-2">
              <Input
                id="rc-base"
                type="number"
                step="0.01"
                min="0.01"
                required
                className={errors.amount_base ? INVALID : undefined}
                value={receipt.amount_base}
                onChange={(e) => setReceipt({ ...receipt, amount_base: e.target.value })}
              />
            </Field>
          )}
          {preview !== null && (
            <div className="rounded-xl bg-muted/50 p-3 text-sm sm:col-span-2">
              At {formatMonth(month)}&apos;s rate (1 {cur} = {Number(s.fx_rate)} {base}) this clears <span className="font-semibold">{money(preview, base)}</span> of the balance.
              {fxGap !== null && fxGap !== 0 && (
                <span className={fxGap > 0 ? "block text-emerald-600" : "block text-red-600"}>
                  The bank paid {money(Math.abs(fxGap), base)} {fxGap > 0 ? "more" : "less"} — recorded as FX {fxGap > 0 ? "gain" : "loss"}.
                </span>
              )}
            </div>
          )}
          <Field id="rc-date" label="Received on *" error={errors.received_on}>
            <Input id="rc-date" type="date" max={todayISO()} required className={errors.received_on ? INVALID : undefined} value={receipt.received_on} onChange={(e) => setReceipt({ ...receipt, received_on: e.target.value })} />
          </Field>
          <Field id="rc-ref" label="Bank reference (UTR)">
            <Input id="rc-ref" placeholder="e.g. UTR 1234567890" value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Record payment</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "adjustment"} onClose={() => setDialog(null)} title="Add adjustment" description={`Changes what ${s.cms_name} owes for ${formatMonth(month)}, in ${base}.`}>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                api("/finance/adjustments", {
                  method: "POST",
                  json: { cms_partner_id: cmsId, month, amount: (Number(adjustment.direction) * Number(adjustment.amount)).toFixed(2), reason: adjustment.reason },
                }),
              "Adjustment added.",
              [["amount", "amount"], ["zero", "amount"], ["reason", "reason"]],
            );
          }}
        >
          <Field id="adj-dir" label="Effect" className="sm:col-span-2">
            <NativeSelect id="adj-dir" value={adjustment.direction} onChange={(e) => setAdjustment({ ...adjustment, direction: e.target.value })}>
              <option value="-1">Reduces what they owe (tax withheld, chargeback, dispute)</option>
              <option value="1">Increases what they owe (late revenue, correction in our favour)</option>
            </NativeSelect>
          </Field>
          <Field id="adj-amount" label={`Amount (${base}) *`} error={errors.amount}>
            <Input id="adj-amount" type="number" step="0.01" min="0.01" required className={errors.amount ? INVALID : undefined} value={adjustment.amount} onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })} />
          </Field>
          <Field id="adj-reason" label="Reason *" error={errors.reason}>
            <Input id="adj-reason" required maxLength={300} placeholder="e.g. TDS withheld" className={errors.reason ? INVALID : undefined} value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Add adjustment</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default function CmsMonthPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CmsMonthPage />
    </Suspense>
  );
}
