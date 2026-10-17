"use client";

import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { MonthPicker } from "@/components/month-picker";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/deals";
import { money, shiftMonth, thisMonth } from "@/lib/finance";
import type { CmsMonthDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

function Box({ label, value, tone }: { label: string; value: string; tone: "green" | "amber" | "plain" }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        tone === "green" && "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
        tone === "amber" && "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
        tone === "plain" && "bg-card",
      )}
    >
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function CmsMonthPage() {
  const { cmsId } = useParams<{ cmsId: string }>();
  const router = useRouter();
  const month = useSearchParams().get("month") ?? shiftMonth(thisMonth(), -1);
  const [data, setData] = useState<CmsMonthDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statement, setStatement] = useState({ gross: "", fee: "", reference: "" });
  const [receipt, setReceipt] = useState({ amount: "", received_on: todayISO(), reference: "" });
  const [adjustment, setAdjustment] = useState({ amount: "", reason: "" });

  const load = useCallback(() => {
    api<CmsMonthDetail>(`/finance/settlements/${cmsId}?month=${month}`)
      .then((d) => {
        setData(d);
        setStatement(
          d.statement
            ? { gross: String(Number(d.statement.gross_amount)), fee: String(Number(d.statement.fee_amount)), reference: d.statement.reference ?? "" }
            : { gross: "", fee: "", reference: "" },
        );
      })
      .catch((err: Error) => setError(err.message));
  }, [cmsId, month]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (!data) return error ? <Notice kind="error">{error}</Notice> : <p className="text-muted-foreground">Loading…</p>;
  const s = data.summary;
  const cur = s.currency;
  const base = data.base_currency;
  const hasCms = cmsId !== "none";
  const net = statement.gross && statement.fee ? (Number(statement.gross) - Number(statement.fee)).toFixed(2) : "";

  return (
    <div className="space-y-8">
      <Link href={`/finance?month=${month}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        CMS & Finance
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{s.cms_name}</h1>
          <p className="text-muted-foreground">{s.fee_rule ? `Fee: ${s.fee_rule}` : hasCms ? "No fee schedule" : "Channels without a CMS"}</p>
        </div>
        <MonthPicker month={month} onChange={(m) => router.replace(`/finance/${cmsId}?month=${m}`)} />
      </div>

      {s.warnings.map((w) => (
        <p key={w} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
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
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <div className="grid gap-6 xl:grid-cols-4">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm xl:col-span-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Content deal</TableHead>
                <TableHead>Views</TableHead>
                <TableHead>Gross revenue</TableHead>
                <TableHead>CMS fee share</TableHead>
                <TableHead>Net</TableHead>
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
                  <TableCell>{c.views?.toLocaleString("en-IN") ?? "—"}</TableCell>
                  <TableCell className="font-semibold">{money(c.gross, cur)}</TableCell>
                  <TableCell>{c.fee_share === null ? "—" : money(c.fee_share, cur)}</TableCell>
                  <TableCell>{c.net_share === null ? "—" : money(c.net_share, cur)}</TableCell>
                </TableRow>
              ))}
              {data.channels.length > 0 && (
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell>Total</TableCell>
                  <TableCell>{data.channels.length} channel(s)</TableCell>
                  <TableCell />
                  <TableCell>{money(s.gross, cur)}</TableCell>
                  <TableCell>{s.fee === null ? "—" : money(s.fee, cur)}</TableCell>
                  <TableCell>{s.net === null ? "—" : money(s.net, cur)}</TableCell>
                </TableRow>
              )}
              {data.channels.length === 0 && <EmptyRow colSpan={6}>No revenue imported for this month.</EmptyRow>}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-4">
          <Box label="Gross" value={money(s.gross, cur)} tone="green" />
          <Box label="CMS fee" value={s.fee === null ? "—" : money(s.fee, cur)} tone="amber" />
          <Box label="Net due" value={s.net === null ? "—" : money(s.net, cur)} tone="green" />
          {s.fx_rate && cur !== base && (
            <p className="text-xs text-muted-foreground">
              1 {cur} = {Number(s.fx_rate)} {base} · net {money(s.net_base, base)}
            </p>
          )}
        </div>
      </div>

      {hasCms && (
        <div className="grid gap-6 xl:grid-cols-3">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">CMS statement</h3>
            <p className="text-sm text-muted-foreground">What {s.cms_name} reported, to check against our numbers.</p>
            {s.variance !== null && (
              <p className={cn("mt-3 text-sm font-semibold", Number(s.variance) === 0 ? "text-emerald-600" : "text-amber-600")}>
                {Number(s.variance) === 0 ? "Matches our net." : `Differs from our net by ${money(s.variance, cur)}.`}
              </p>
            )}
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    api("/finance/statements", {
                      method: "PUT",
                      json: {
                        cms_partner_id: cmsId,
                        month,
                        currency: cur ?? "USD",
                        gross_amount: statement.gross,
                        fee_amount: statement.fee,
                        net_amount: net,
                        reference: statement.reference || null,
                      },
                    }),
                  "Statement saved.",
                );
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="st-gross">Gross ({cur ?? "USD"}) *</Label>
                  <Input id="st-gross" type="number" step="0.01" min="0" required value={statement.gross} onChange={(e) => setStatement({ ...statement, gross: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="st-fee">Fee *</Label>
                  <Input id="st-fee" type="number" step="0.01" min="0" required value={statement.fee} onChange={(e) => setStatement({ ...statement, fee: e.target.value })} />
                </div>
              </div>
              <p className="text-sm">
                Net: <span className="font-semibold">{net ? money(net, cur) : "—"}</span>
              </p>
              <Input aria-label="Statement reference" placeholder="Statement no. / reference" value={statement.reference} onChange={(e) => setStatement({ ...statement, reference: e.target.value })} />
              <Button type="submit" className="w-full">
                Save statement
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Cash received</h3>
            <p className="text-sm text-muted-foreground">Bank receipts for this month, in {base}.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {data.receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{money(r.amount, base)}</span>
                    <span className="text-muted-foreground"> · {formatDate(r.received_on)}{r.reference ? ` · ${r.reference}` : ""}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete receipt"
                    onClick={() => window.confirm("Delete this receipt?") && run(() => api(`/finance/receipts/${r.id}`, { method: "DELETE" }), "Receipt deleted.")}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              {data.receipts.length === 0 && <li className="text-muted-foreground">Nothing received yet.</li>}
            </ul>
            <form
              className="mt-4 space-y-3 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/finance/receipts", {
                    method: "POST",
                    json: { cms_partner_id: cmsId, month, amount: receipt.amount, received_on: receipt.received_on, reference: receipt.reference || null },
                  });
                  setReceipt({ amount: "", received_on: todayISO(), reference: "" });
                }, "Receipt added.");
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="rc-amount">Amount ({base}) *</Label>
                  <Input id="rc-amount" type="number" step="0.01" min="0.01" required value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rc-date">Received on *</Label>
                  <Input id="rc-date" type="date" max={todayISO()} required value={receipt.received_on} onChange={(e) => setReceipt({ ...receipt, received_on: e.target.value })} />
                </div>
              </div>
              <Input aria-label="Bank reference" placeholder="UTR / bank reference" value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} />
              <Button type="submit" className="w-full">
                Add receipt
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Adjustments</h3>
            <p className="text-sm text-muted-foreground">Tax withheld, disputes, revisions. Negative reduces what the CMS owes.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {data.adjustments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className={cn("font-semibold", Number(a.amount) < 0 && "text-red-600")}>{money(a.amount, base)}</span>
                    <span className="text-muted-foreground"> · {a.reason}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete adjustment"
                    onClick={() => window.confirm("Delete this adjustment?") && run(() => api(`/finance/adjustments/${a.id}`, { method: "DELETE" }), "Adjustment deleted.")}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              {data.adjustments.length === 0 && <li className="text-muted-foreground">None.</li>}
            </ul>
            <form
              className="mt-4 space-y-3 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/finance/adjustments", { method: "POST", json: { cms_partner_id: cmsId, month, amount: adjustment.amount, reason: adjustment.reason } });
                  setAdjustment({ amount: "", reason: "" });
                }, "Adjustment added.");
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="adj-amount">Amount ({base}) *</Label>
                <Input id="adj-amount" type="number" step="0.01" required placeholder="-50000" value={adjustment.amount} onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })} />
              </div>
              <Input aria-label="Reason" required placeholder="Reason, e.g. TDS withheld" value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} />
              <Button type="submit" className="w-full">
                Add adjustment
              </Button>
            </form>
            <div className="mt-6 space-y-1 border-t pt-4 text-sm">
              <p className="flex justify-between"><span className="text-muted-foreground">Net receivable</span><span>{money(s.net_base, base)}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">± Adjustments</span><span>{money(s.adjustments, base)}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">− Received</span><span>{money(s.received, base)}</span></p>
              <p className="flex justify-between text-base font-bold"><span>Outstanding</span><span>{money(s.outstanding, base)}</span></p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function CmsMonthPageWrapper() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <CmsMonthPage />
    </Suspense>
  );
}
