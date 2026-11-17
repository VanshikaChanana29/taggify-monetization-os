"use client";

import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { DealPartners } from "@/components/deal/partners";
import { DealPayments } from "@/components/deal/payments";
import { InlineLoader, PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, DEAL_TYPE_LABELS, dealValue, episodeSummary, formatDate, formatMoney } from "@/lib/deals";
import { compactInr } from "@/lib/finance";
import type { ContractRef, DealEconomics, ParentDeal } from "@/lib/types";

type Tab = "shows" | "partners" | "payments";
const TABS: Tab[] = ["shows", "partners", "payments"];

function Fact({ label, value, sub, info }: { label: string; value: React.ReactNode; sub?: React.ReactNode; info?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {info && <InfoTip text={info} />}
      </p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProfitCell({ profit, recovery }: { profit: string | null | undefined; recovery?: string | null }) {
  if (profit == null) return <>—</>;
  const n = Number(profit);
  return (
    <>
      <span className={n >= 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-red-700 dark:text-red-400"}>
        {n >= 0 ? "+" : "−"}
        {compactInr(String(Math.abs(n)))}
      </span>
      {recovery != null && <span className="block text-xs text-muted-foreground">{Math.round(Number(recovery))}% covered</span>}
    </>
  );
}

function ParentDealDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "shows";

  const [parent, setParent] = useState<ParentDeal | null>(null);
  const [economics, setEconomics] = useState<DealEconomics | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(params.get("added") ? "Deal created. Now add its shows." : null);

  const load = useCallback(() => {
    api<ParentDeal>(`/parent-deals/${id}`)
      .then(setParent)
      .catch((err: Error) => setError(err.message));
    api<DealEconomics>(`/parent-deals/${id}/economics`)
      .then(setEconomics)
      .catch(() => {});
  }, [id]);
  useEffect(load, [load, refreshKey]);

  const refresh = useCallback((message?: string) => {
    setNotice(message ?? null);
    setRefreshKey((k) => k + 1);
  }, []);

  function go(next: Tab) {
    setNotice(null);
    router.replace(next === "shows" ? `/parent-deals/${id}` : `/parent-deals/${id}?tab=${next}`, { scroll: false });
  }

  async function remove() {
    if (!parent || !window.confirm(`Delete ${parent.name}? It has no shows.`)) return;
    try {
      await api(`/parent-deals/${parent.id}`, { method: "DELETE" });
      router.push("/deals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (error && !parent) return <Notice kind="error">{error}</Notice>;
  if (!parent) return <PageLoader />;

  const pays = parent.deal_type === "fixed_fee" || parent.deal_type === "hybrid";
  const amount = Number(parent.amount ?? 0);
  const used = Number(parent.allotted ?? 0);
  const usedPct = amount > 0 ? Math.min(100, (used / amount) * 100) : 0;
  const contract: ContractRef = {
    id: parent.id,
    deal_type: parent.deal_type,
    fee_amount: parent.amount,
    currency: parent.currency,
    owner_name: parent.owner_name,
  };
  const overdue = economics?.installments.some((i) => i.overdue) ?? false;

  return (
    <div className="space-y-6">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        All deals
      </Link>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{parent.owner_name}</p>
            <h1 className="text-3xl font-bold tracking-tight">{parent.name}</h1>
            <div className="mt-2 flex items-center gap-2">
              <Pill tone={DEAL_STATUS_TONES[parent.status]}>{DEAL_STATUS_LABELS[parent.status]}</Pill>
              <span className="text-sm text-muted-foreground">{DEAL_TYPE_LABELS[parent.deal_type]}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {parent.show_count === 0 && (
              <Button variant="outline" onClick={remove}>
                <Trash2 />
                Delete
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/parent-deals/${parent.id}/edit`}>
                <Pencil />
                Edit deal
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/deals/new?parent=${parent.id}`}>
                <Plus />
                Add show
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2 lg:grid-cols-5">
          <Fact
            label={parent.deal_type === "hybrid" ? "Total guarantee" : "Deal amount"}
            value={pays ? formatMoney(parent.amount, parent.currency) : DEAL_TYPE_LABELS[parent.deal_type]}
          />
          <Fact
            label="Given to shows"
            info="What the shows' own amounts add up to. It can never go above the deal amount."
            value={pays ? formatMoney(parent.allotted, parent.currency) : "—"}
            sub={
              pays ? (
                <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
                </span>
              ) : undefined
            }
          />
          <Fact label="Left for new shows" value={pays ? formatMoney(parent.unallotted, parent.currency) : "—"} />
          <Fact
            label="Term"
            value={`${parent.term_start.slice(0, 4)}–${parent.term_end.slice(0, 4)}`}
            sub={`${formatDate(parent.term_start)} → ${formatDate(parent.term_end)}`}
          />
          <Fact
            label="Profit / loss"
            info="Everything the deal's shows earned, minus the whole deal amount (your part, after partners)."
            value={<ProfitCell profit={parent.profit} recovery={parent.recovery_pct} />}
          />
        </div>
        {parent.notes && <p className="mt-4 whitespace-pre-line border-t pt-4 text-sm text-muted-foreground">{parent.notes}</p>}
      </div>

      <Tabs
        value={tab}
        onChange={go}
        tabs={[
          { key: "shows", label: "Shows", count: parent.show_count },
          { key: "partners", label: "Partners" },
          { key: "payments", label: "Payments", count: economics?.installments.length, alert: overdue },
        ]}
      />

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {tab === "shows" && (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No.</TableHead>
                <TableHead>Show</TableHead>
                <TableHead>{pays ? "Show amount" : "Terms"}</TableHead>
                <TableHead>Episodes</TableHead>
                <TableHead>Term ends</TableHead>
                <TableHead>Slots in use</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Profit / loss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parent.shows.map((s, idx) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/deals/${s.id}`)}>
                  <TableCell className="w-14 tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <Link href={`/deals/${s.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {s.title}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {dealValue(s)}
                    {pays && amount > 0 && s.fee_amount && (
                      <span className="block text-xs text-muted-foreground">{Math.round((Number(s.fee_amount) / amount) * 1000) / 10}% of the deal</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">{episodeSummary(s.episode_scope, s.episode_ranges)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(s.term_end)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    YT {s.yt_slots_used}/{s.yt_slot_limit} · FB {s.fb_slots_used}/{s.fb_slot_limit}
                  </TableCell>
                  <TableCell>
                    <Pill tone={DEAL_STATUS_TONES[s.status]}>{DEAL_STATUS_LABELS[s.status]}</Pill>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <ProfitCell profit={s.profit} recovery={s.recovery_pct} />
                  </TableCell>
                </TableRow>
              ))}
              {parent.shows.length === 0 && (
                <EmptyRow colSpan={8}>
                  No shows yet.{" "}
                  <Link href={`/deals/new?parent=${parent.id}`} className="font-medium text-primary hover:underline">
                    Add the first show
                  </Link>
                </EmptyRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {tab === "partners" && <DealPartners deal={contract} onChange={(m) => refresh(m)} />}
      {tab === "payments" && (economics ? <DealPayments deal={contract} e={economics} onChange={() => refresh()} /> : <InlineLoader />)}
    </div>
  );
}

export default function ParentDealPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ParentDealDetail />
    </Suspense>
  );
}
