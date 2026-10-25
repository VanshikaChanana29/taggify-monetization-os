"use client";

import { AlertTriangle, Calculator, CheckCircle2, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Fragment, Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { useFinanceMonth } from "@/components/finance/finance-shell";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES } from "@/lib/deals";
import { formatMonth, money } from "@/lib/finance";
import { HELP } from "@/lib/help";
import { formatDateTime } from "@/lib/format";
import type { IncentiveRun } from "@/lib/types";
import { PageLoader } from "@/components/loader";

const STATUS: Record<IncentiveRun["status"], { label: string; tone: string; help: string }> = {
  preview: { label: "Not calculated", tone: DEAL_STATUS_TONES.expired, help: "Live preview from today's data. Calculate to save a draft." },
  draft: { label: "Draft", tone: DEAL_STATUS_TONES.draft, help: "Saved. Recalculate after fixing data, then approve." },
  approved: { label: "Approved", tone: DEAL_STATUS_TONES.active, help: "Frozen. Reopen to change, or close the month to lock it." },
  locked: { label: "Locked", tone: DEAL_STATUS_TONES.upcoming, help: "The month is closed. Reopen the month to change anything." },
};

function IncentivesPage() {
  const [month] = useFinanceMonth();
  const [run, setRun] = useState<IncentiveRun | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRun(null);
    api<IncentiveRun>(`/finance/incentives?month=${month}`).then(setRun).catch((err: Error) => setError(err.message));
  }, [month]);
  useEffect(load, [load]);

  async function act(path: string) {
    setBusy(true);
    setError(null);
    try {
      setRun(await api<IncentiveRun>(`/finance/incentives/${path}`, { method: "POST", json: { month } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const base = run?.base_currency ?? "INR";
  const status = run ? STATUS[run.status] : null;

  return (
    <div className="space-y-8">
      <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold">
            Incentives for {formatMonth(month)}
            <InfoTip text={HELP.incentiveRate} />
          </h3>
          <p className="text-sm text-muted-foreground">
            Each person&apos;s % of the gross of the channels they managed — and team leads on their team&apos;s channels — counted day by day (PDF slides 12–13).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          {run && (
            <p className="w-full text-sm text-muted-foreground sm:w-auto">
              {run.status === "preview" && "Step 1: Calculate to save this as a draft. Step 2: Approve it for payout."}
              {run.status === "draft" && "Saved as a draft. Check the lines, then Approve (or Recalculate after fixing data)."}
              {run.status === "approved" && "Approved and frozen for payout. Reopen only to correct a mistake."}
              {run.status === "locked" && "The month is closed, so these incentives are locked."}
            </p>
          )}
          {run && (run.status === "preview" || run.status === "draft") && (
            <Button variant={run.status === "preview" ? "default" : "outline"} disabled={busy} onClick={() => act("compute")}>
              <Calculator />
              {run.status === "preview" ? "Calculate" : "Recalculate"}
            </Button>
          )}
          {run?.status === "draft" && (
            <Button disabled={busy} onClick={() => act("approve")}>
              <CheckCircle2 />
              Approve
            </Button>
          )}
          {run?.status === "approved" && (
            <Button variant="outline" disabled={busy} onClick={() => act("reopen")}>
              <RotateCcw />
              Reopen
            </Button>
          )}
          {run?.status === "locked" && (
            <Button variant="outline" asChild>
              <Link href={`/finance/close?month=${month}`}>
                <Lock />
                Month is closed
              </Link>
            </Button>
          )}
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {run && status && (
        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Status</p>
            <div className="mt-3">
              <Pill tone={status.tone}>{status.label}</Pill>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{status.help}</p>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Total incentives</p>
            <p className="mt-3 text-3xl font-bold">{money(run.total_base, base)}</p>
            <p className="text-xs text-muted-foreground">{run.people.length} people</p>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-sm text-sm">
            <p className="font-medium uppercase tracking-wider text-muted-foreground">History</p>
            <p className="mt-3">Calculated: {run.computed_at ? formatDateTime(run.computed_at) : "—"}</p>
            <p>Approved: {run.approved_at ? `${run.approved_by} · ${formatDateTime(run.approved_at)}` : "—"}</p>
          </div>
        </div>
      )}

      {run?.warnings.map((w) => (
        <p key={w} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {w}
        </p>
      ))}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>As manager</TableHead>
              <TableHead>As team lead</TableHead>
              <TableHead>Total ({base})</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run?.people.map((p) => (
              <Fragment key={p.employee.id}>
                <TableRow className="cursor-pointer" onClick={() => setOpen(open === p.employee.id ? null : p.employee.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={p.employee.name} seed={p.employee.id} className="h-9 w-9 text-xs" />
                      <Link href={`/people/${p.employee.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                        {p.employee.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>{money(p.manager_base, base)}</TableCell>
                  <TableCell>{money(p.team_lead_base, base)}</TableCell>
                  <TableCell className="font-bold">{money(p.total_base, base)}</TableCell>
                </TableRow>
                {open === p.employee.id &&
                  run.lines
                    .filter((l) => l.employee.id === p.employee.id)
                    .map((l) => (
                      <TableRow key={`${l.channel_id}-${l.kind}-${l.currency}`} className="bg-muted/40 text-sm hover:bg-muted/40">
                        <TableCell className="pl-16">
                          <Link href={`/channels/${l.channel_id}`} className="hover:text-primary">
                            {l.channel_name}
                          </Link>
                          <span className="text-muted-foreground"> · {l.kind === "manager" ? "manager" : "team lead"} · {l.days} day(s)</span>
                        </TableCell>
                        <TableCell colSpan={2} className="text-muted-foreground">
                          {money(l.gross, l.currency)} gross × {l.rates} = {money(l.amount, l.currency)}
                        </TableCell>
                        <TableCell>{money(l.amount_base, base)}</TableCell>
                      </TableRow>
                    ))}
              </Fragment>
            ))}
            {run && run.people.length === 0 && (
              <EmptyRow colSpan={4}>
                Nobody earned incentives this month. Incentives need revenue, a manager on the channel, and a rate on the person&apos;s page.
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function IncentivesPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <IncentivesPage />
    </Suspense>
  );
}
