"use client";

import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Info } from "lucide-react";

import { RightsChecker } from "@/components/deal/rights-check";
import { daysBetween } from "@/components/deal/form-bits";
import { COUNTRY_NAMES, formatDate, todayISO } from "@/lib/deals";
import { money } from "@/lib/finance";
import type { Deal, DealEconomics, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DealTab = "overview" | "slots" | "payments" | "profitability" | "episodes" | "documents" | "activity";

type Todo = { tone: "danger" | "warning" | "info"; text: string; tab: DealTab };

const TONE = {
  danger: { icon: AlertOctagon, cls: "text-red-600 dark:text-red-400" },
  warning: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, cls: "text-sky-600 dark:text-sky-400" },
};

function slotsOf(deal: Deal, platform: Platform) {
  const mine = deal.slots.filter((s) => s.platform === platform);
  return {
    limit: mine.length,
    active: mine.filter((s) => s.status === "active").length,
    pending: mine.filter((s) => s.status === "pending_whitelist").length,
    used: mine.filter((s) => s.status !== "unassigned").length,
  };
}

function todos(deal: Deal, e: DealEconomics | null): Todo[] {
  const out: Todo[] = [];
  const today = todayISO();
  if (e) {
    for (const i of e.installments.filter((x) => x.overdue)) {
      out.push({ tone: "danger", text: `Installment of ${money(i.amount, e.base_currency)} was due ${formatDate(i.due_date)} — not paid`, tab: "payments" });
    }
    if ((deal.deal_type === "fixed_fee" || deal.deal_type === "hybrid") && e.installments.length === 0) {
      out.push({ tone: "info", text: "No payment plan yet — add the installments from the contract", tab: "payments" });
    }
  }
  if (deal.notice_deadline && deal.notice_deadline >= today) {
    const days = daysBetween(today, deal.notice_deadline);
    if (days <= 60) out.push({ tone: days <= 7 ? "danger" : "warning", text: `Renewal notice due to ${deal.owner_name} by ${formatDate(deal.notice_deadline)} (${days} days)`, tab: "overview" });
  }
  const pending = deal.slots.filter((s) => s.status === "pending_whitelist");
  if (pending.length) out.push({ tone: "warning", text: `${pending.length} slot(s) waiting for whitelist approval: ${pending.map((s) => s.code).join(", ")}`, tab: "slots" });
  const empty = deal.slots.filter((s) => s.status === "unassigned").length;
  if (empty && deal.status === "active") out.push({ tone: "info", text: `${empty} slot(s) not used yet`, tab: "slots" });
  if (deal.document_count === 0) out.push({ tone: "info", text: "Signed contract not uploaded", tab: "documents" });
  if (deal.episode_scope !== "all" && deal.episode_count === 0) out.push({ tone: "info", text: "No episode titles yet", tab: "episodes" });
  return out;
}

function SummaryCard({
  title,
  value,
  sub,
  alert,
  onClick,
  children,
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  alert?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-2xl border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/50",
        alert && "border-red-300 dark:border-red-500/40",
      )}
    >
      <span className="flex items-center justify-between text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
        <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="mt-2 text-2xl font-bold">{value}</span>
      {sub && <span className="mt-1 text-sm text-muted-foreground">{sub}</span>}
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t py-2.5 first:border-t-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export function DealOverview({ deal, e, go }: { deal: Deal; e: DealEconomics | null; go: (tab: DealTab) => void }) {
  const yt = slotsOf(deal, "youtube");
  const fb = slotsOf(deal, "facebook");
  const overdue = e?.installments.filter((i) => i.overdue).length ?? 0;
  const pays = deal.deal_type === "fixed_fee" || deal.deal_type === "hybrid";
  const pct = e?.recovery_pct ? Number(e.recovery_pct) : null;
  const list = todos(deal, e);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pays && e ? (
          <SummaryCard
            title="Payments to owner"
            value={Number(e.payable) > 0 ? `${money(e.payable, e.base_currency)} due` : "All paid"}
            sub={`Paid ${money(e.paid, e.base_currency)} of ${money(deal.fee_amount, deal.currency)}`}
            alert={overdue > 0}
            onClick={() => go("payments")}
          >
            {overdue > 0 && <span className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">{overdue} overdue</span>}
          </SummaryCard>
        ) : (
          <SummaryCard title="Payments to owner" value="No licence fee" sub="Revenue share / owned content" onClick={() => go("profitability")} />
        )}
        <SummaryCard
          title="Recovery"
          value={pct === null ? "—" : `${pct}%`}
          sub={e?.rights_cost ? `${money(e.net_contribution, e.base_currency)} of ${money(e.rights_cost, e.base_currency)} earned back` : "No rights cost"}
          onClick={() => go("profitability")}
        >
          {pct !== null && (
            <span className="mt-3 block h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </span>
          )}
        </SummaryCard>
        <SummaryCard
          title="Slots in use"
          value={[yt.limit && `YT ${yt.used}/${yt.limit}`, fb.limit && `FB ${fb.used}/${fb.limit}`].filter(Boolean).join(" · ")}
          sub={`${yt.active + fb.active} active · ${yt.pending + fb.pending} pending whitelist`}
          onClick={() => go("slots")}
        />
        <SummaryCard
          title="Episodes & files"
          value={`${deal.episode_count} episode${deal.episode_count === 1 ? "" : "s"}`}
          sub={`${deal.document_count} file${deal.document_count === 1 ? "" : "s"} uploaded`}
          onClick={() => go(deal.episode_count ? "documents" : "episodes")}
        />
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">What needs doing</h3>
        <ul className="mt-3 divide-y">
          {list.map((t) => {
            const T = TONE[t.tone];
            return (
              <li key={t.text}>
                <button type="button" onClick={() => go(t.tab)} className="flex w-full items-center gap-3 py-3 text-left text-sm hover:text-primary">
                  <T.icon className={cn("h-5 w-5 shrink-0", T.cls)} />
                  <span className="flex-1">{t.text}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            );
          })}
          {list.length === 0 && (
            <li className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Nothing pending on this deal.
            </li>
          )}
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Contract terms</h3>
          <dl className="mt-3 text-sm">
            <Row label="Territory">{deal.is_worldwide ? "Worldwide" : deal.territories.map((t) => COUNTRY_NAMES[t] ?? t).join(", ")}</Row>
            <Row label="Languages">{deal.languages.length ? deal.languages.join(", ") : "—"}</Row>
            <Row label="Exclusivity">
              {deal.exclusivity === "exclusive" ? "Exclusive" : deal.exclusivity === "non_exclusive" ? "Non-exclusive" : "—"}
            </Row>
            <Row label="Notice period">
              {deal.notice_period_days === null ? (
                "—"
              ) : (
                <>
                  {deal.notice_period_days} days
                  {deal.notice_deadline && (
                    <span className="block text-xs font-normal text-muted-foreground">Tell the owner by {formatDate(deal.notice_deadline)}</span>
                  )}
                </>
              )}
            </Row>
            <Row label="Agreement version">{deal.agreement_version ?? "—"}</Row>
            <Row label="Contract link">
              {deal.contract_url ? (
                <a href={deal.contract_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Owner contact">
              {deal.owner_contact_name ?? "—"}
              {deal.owner_contact_email && <span className="block font-normal text-muted-foreground">{deal.owner_contact_email}</span>}
            </Row>
          </dl>
          {[
            ["Renewal terms", deal.renewal_terms],
            ["Clip restrictions", deal.clip_restrictions],
            ["Notes", deal.notes],
          ]
            .filter(([, v]) => v)
            .map(([label, v]) => (
              <div key={label} className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
                <p className="font-medium text-muted-foreground">{label}</p>
                <p className="mt-1 whitespace-pre-wrap">{v}</p>
              </div>
            ))}
        </section>
        <RightsChecker deal={deal} />
      </div>
    </div>
  );
}
