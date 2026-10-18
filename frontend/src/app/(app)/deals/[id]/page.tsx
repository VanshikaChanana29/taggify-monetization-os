"use client";

import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { DealActivity } from "@/components/deal/activity";
import { type DealTab, DealOverview } from "@/components/deal/overview";
import { DealPayments } from "@/components/deal/payments";
import { DealProfitability } from "@/components/deal/profitability";
import { DealSlots } from "@/components/deal/slots";
import { DealDocuments } from "@/components/deal-documents";
import { DealEpisodes } from "@/components/deal-episodes";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, DEAL_TYPE_LABELS, dealValue, episodeSummary, formatDate } from "@/lib/deals";
import type { Deal, DealEconomics } from "@/lib/types";

const TABS: DealTab[] = ["overview", "slots", "payments", "profitability", "episodes", "documents", "activity"];

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab") as DealTab | null;
  const tab: DealTab = requested && TABS.includes(requested) ? requested : "overview";

  const [deal, setDeal] = useState<Deal | null>(null);
  const [economics, setEconomics] = useState<DealEconomics | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Deal>(`/deals/${id}`)
      .then(setDeal)
      .catch((err: Error) => setError(err.message));
    api<DealEconomics>(`/deals/${id}/economics`)
      .then(setEconomics)
      .catch(() => {});
  }, [id]);
  useEffect(load, [load, refreshKey]);

  const refresh = useCallback((message?: string) => {
    setNotice(message ?? null);
    setRefreshKey((k) => k + 1);
  }, []);

  function go(next: DealTab) {
    setNotice(null);
    router.replace(next === "overview" ? `/deals/${id}` : `/deals/${id}?tab=${next}`, { scroll: false });
  }

  if (error && !deal) return <Notice kind="error">{error}</Notice>;
  if (!deal) return <p className="text-muted-foreground">Loading…</p>;

  const overdue = economics?.installments.some((i) => i.overdue) ?? false;
  const pending = deal.slots.some((s) => s.status === "pending_whitelist");

  return (
    <div className="space-y-6">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        All deals
      </Link>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{deal.owner_name}</p>
            <h1 className="text-3xl font-bold tracking-tight">{deal.title}</h1>
            <div className="mt-2 flex items-center gap-2">
              <Pill tone={DEAL_STATUS_TONES[deal.status]}>{DEAL_STATUS_LABELS[deal.status]}</Pill>
              <span className="text-sm text-muted-foreground">{DEAL_TYPE_LABELS[deal.deal_type]}</span>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/deals/${deal.id}/edit`}>
              <Pencil />
              Edit deal
            </Link>
          </Button>
        </div>
        <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2 lg:grid-cols-5">
          <Fact label={deal.deal_type === "hybrid" ? "Guarantee + share" : "Licence value"} value={dealValue(deal)} />
          <Fact label="Episodes" value={episodeSummary(deal.episode_scope, deal.episode_ranges)} />
          <Fact label="Term" value={`${deal.term_start.slice(0, 4)}–${deal.term_end.slice(0, 4)}`} sub={`${formatDate(deal.term_start)} → ${formatDate(deal.term_end)}`} />
          <Fact label="YouTube slots" value={deal.yt_slot_limit ? `${deal.yt_slots_used} / ${deal.yt_slot_limit}` : "None"} sub={deal.yt_slot_limit ? "in use" : undefined} />
          <Fact label="Facebook slots" value={deal.fb_slot_limit ? `${deal.fb_slots_used} / ${deal.fb_slot_limit}` : "None"} sub={deal.fb_slot_limit ? "in use" : undefined} />
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={go}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "slots", label: "Slots", count: deal.yt_slot_limit + deal.fb_slot_limit, alert: pending },
          { key: "payments", label: "Payments", count: economics?.installments.length, alert: overdue },
          { key: "profitability", label: "Profitability" },
          { key: "episodes", label: "Episodes", count: deal.episode_count },
          { key: "documents", label: "Documents", count: deal.document_count },
          { key: "activity", label: "Activity" },
        ]}
      />

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {tab === "overview" && <DealOverview deal={deal} e={economics} go={go} />}
      {tab === "slots" && <DealSlots deal={deal} refreshKey={refreshKey} onChange={refresh} />}
      {tab === "payments" && (economics ? <DealPayments deal={deal} e={economics} onChange={() => refresh()} /> : <p className="text-muted-foreground">Loading…</p>)}
      {tab === "profitability" &&
        (economics ? <DealProfitability deal={deal} e={economics} onChange={() => refresh()} /> : <p className="text-muted-foreground">Loading…</p>)}
      {tab === "episodes" && <DealEpisodes dealId={deal.id} scope={deal.episode_scope} onChange={() => refresh()} />}
      {tab === "documents" && <DealDocuments dealId={deal.id} onChange={() => refresh()} />}
      {tab === "activity" && <DealActivity dealId={deal.id} refreshKey={refreshKey} />}
    </div>
  );
}

export default function DealDetailPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <DealDetail />
    </Suspense>
  );
}
