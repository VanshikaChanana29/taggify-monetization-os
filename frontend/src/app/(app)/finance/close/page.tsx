"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Lock, LockOpen, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { MonthPicker } from "@/components/month-picker";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr, formatMonth, shiftMonth, thisMonth } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import type { CloseStatus, ClosedMonth } from "@/lib/types";

const STEPS = [
  { key: "revenue", label: "1–2 · Platform data", href: "/finance/revenue" },
  { key: "pricing", label: "3 · Fee tiers + FX", href: "/finance/fx" },
  { key: "statements", label: "4–5 · CMS statements reconciled", href: "/finance" },
  { key: "cash", label: "6 · Cash received", href: "/finance" },
  { key: "incentives", label: "7 · Incentives approved", href: "/finance/incentives" },
];

function ClosePage() {
  const router = useRouter();
  const month = useSearchParams().get("month") ?? shiftMonth(thisMonth(), -1);
  const [status, setStatus] = useState<CloseStatus | null>(null);
  const [closes, setCloses] = useState<ClosedMonth[]>([]);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CloseStatus>(`/finance/close?month=${month}`).then(setStatus).catch((err: Error) => setError(err.message));
    api<ClosedMonth[]>("/finance/closes").then(setCloses).catch(() => {});
  }, [month]);
  useEffect(load, [load]);

  async function run(path: string, json: object, message: string) {
    setError(null);
    setNotice(null);
    try {
      setStatus(await api<CloseStatus>(path, { method: "POST", json }));
      setNotice(message);
      setNotes("");
      setReason("");
      api<ClosedMonth[]>("/finance/closes").then(setCloses).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="space-y-8">
      <Link href={`/finance?month=${month}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        CMS & Finance
      </Link>
      <PageHeader
        title="Month close"
        description="Lock a finished month (PDF slide 16 step 8). After closing, later platform revisions become traceable adjustments, not silent overwrites."
      />
      <div className="flex">
        <MonthPicker month={month} onChange={(m) => router.replace(`/finance/close?month=${m}`)} />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {status && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border bg-card p-6 shadow-sm lg:col-span-2">
            <h3 className="text-lg font-semibold">Checklist · {formatMonth(month)}</h3>
            <ul className="mt-4 space-y-3">
              {STEPS.map((step) => {
                const check = status.checks.find((c) => c.key === step.key);
                if (!check) return null;
                const Icon = check.ok ? CheckCircle2 : check.blocking ? XCircle : AlertTriangle;
                const tone = check.ok ? "text-emerald-600" : check.blocking ? "text-red-600" : "text-amber-600";
                return (
                  <li key={step.key} className="flex items-start gap-3 rounded-xl border p-4">
                    <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} />
                    <div className="flex-1">
                      <p className="font-semibold">
                        {step.label}
                        {!check.blocking && <span className="ml-2 text-xs font-normal text-muted-foreground">recommended</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{check.message}</p>
                    </div>
                    {!check.ok && (
                      <Link href={`${step.href}?month=${month}`} className="text-sm font-semibold text-primary hover:underline">
                        Fix
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            {status.closed ? (
              <>
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-sky-600" />
                  <h3 className="text-lg font-semibold">Closed</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  By {status.closed_by} on {status.closed_at ? formatDateTime(status.closed_at) : "—"}
                </p>
                {status.notes && <p className="mt-2 text-sm">{status.notes}</p>}
                <form
                  className="mt-6 space-y-3 border-t pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run("/finance/reopen", { month, reason }, `${formatMonth(month)} reopened.`);
                  }}
                >
                  <p className="text-sm text-muted-foreground">Reopening unlocks the month. The reason and the closed numbers are kept in Activity.</p>
                  <Input aria-label="Reason" required minLength={3} placeholder="Reason, e.g. CMS revised its statement" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button type="submit" variant="outline" className="w-full">
                    <LockOpen />
                    Reopen month
                  </Button>
                </form>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run("/finance/close", { month, notes: notes || null }, `${formatMonth(month)} closed.`);
                }}
                className="space-y-3"
              >
                <h3 className="text-lg font-semibold">Close {formatMonth(month)}</h3>
                <p className="text-sm text-muted-foreground">
                  Locks revenue, FX, fee tiers, incentive rates and back-dated handovers for this month. Cash receipts and adjustments still work.
                </p>
                <Input aria-label="Notes" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button type="submit" className="w-full" disabled={!status.can_close}>
                  <Lock />
                  Close month
                </Button>
                {!status.can_close && <p className="text-xs text-red-600">Fix the red items first.</p>}
              </form>
            )}
          </section>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Closed month</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead>Incentives</TableHead>
              <TableHead>Outstanding at close</TableHead>
              <TableHead>Closed by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {closes.map((c) => (
              <TableRow key={c.month} className="cursor-pointer" onClick={() => router.replace(`/finance/close?month=${c.month}`)}>
                <TableCell className="font-semibold">{formatMonth(c.month)}</TableCell>
                <TableCell>{compactInr(c.gross)}</TableCell>
                <TableCell>{compactInr(c.incentives)}</TableCell>
                <TableCell>{compactInr(c.outstanding)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.closed_by} · {formatDateTime(c.closed_at)}
                </TableCell>
              </TableRow>
            ))}
            {closes.length === 0 && <EmptyRow colSpan={5}>No month has been closed yet.</EmptyRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function ClosePageWrapper() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <ClosePage />
    </Suspense>
  );
}
