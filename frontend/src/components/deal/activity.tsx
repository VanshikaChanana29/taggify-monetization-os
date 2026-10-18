"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { DEAL_TYPE_LABELS, SLOT_STATUS_LABELS } from "@/lib/deals";
import { formatDateTime } from "@/lib/format";
import type { AuditLog, Page } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  owner_id: "Owner",
  title: "Title",
  deal_type: "Deal type",
  status: "Status",
  fee_amount: "Fee",
  currency: "Currency",
  revenue_share_pct: "Revenue share %",
  term_start: "Term start",
  term_end: "Term end",
  episode_scope: "Episode scope",
  episode_ranges: "Episode ranges",
  is_worldwide: "Worldwide",
  territories: "Territories",
  yt_slot_limit: "YouTube slots",
  fb_slot_limit: "Facebook slots",
  contract_url: "Contract link",
  notes: "Notes",
  languages: "Languages",
  exclusivity: "Exclusivity",
  renewal_terms: "Renewal terms",
  notice_period_days: "Notice period (days)",
  clip_restrictions: "Clip restrictions",
  agreement_version: "Agreement version",
  channel: "Channel",
};

const VALUE_LABELS: Record<string, string> = {
  ...SLOT_STATUS_LABELS,
  ...DEAL_TYPE_LABELS,
  exclusive: "Exclusive",
  non_exclusive: "Non-exclusive",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && VALUE_LABELS[value]) return VALUE_LABELS[value];
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === "object") {
      return value
        .map((r: { season: number | null; from_episode: number; to_episode: number }) =>
          `${r.season ? `S${r.season} ` : ""}${r.from_episode}–${r.to_episode}`,
        )
        .join(", ");
    }
    return value.join(", ") || "—";
  }
  return String(value);
}

export function DealActivity({ dealId, refreshKey }: { dealId: string; refreshKey: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => {
    api<Page<AuditLog>>(`/audit-logs?entity_type=deal&entity_id=${dealId}&page_size=50`)
      .then((p) => setLogs(p.items))
      .catch(() => {});
  }, [dealId, refreshKey]);

  const label: Record<string, string> = {
    "deal.created": "created the deal",
    "deal.updated": "edited the deal",
    "slot.updated": "updated a slot",
    "slot.assigned": "assigned a channel",
    "slot.replaced": "replaced a channel",
    "slot.unassigned": "removed a channel",
    "deal.installment_added": "added an installment",
    "deal.installment_paid": "marked an installment paid",
    "deal.installment_unpaid": "marked an installment unpaid",
    "deal.installment_deleted": "deleted an installment",
    "deal.expense_added": "added an expense",
    "deal.expense_deleted": "deleted an expense",
    "episode.added": "added episode details",
    "episode.updated": "edited episode details",
    "episode.deleted": "deleted episode details",
    "episode.imported": "imported episodes",
    "document.uploaded": "uploaded a document",
    "document.deleted": "deleted a document",
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">Activity</h3>
      <ul className="mt-4 space-y-4">
        {logs.map((log) => {
          const changes = (log.details.changes ?? {}) as Record<string, [unknown, unknown]>;
          const slot = typeof log.details.slot === "string" ? `${log.details.slot}: ` : "";
          return (
            <li key={log.id} className="border-l-2 border-primary/40 pl-4 text-sm">
              <p>
                <span className="font-semibold">{log.user_name ?? "System"}</span> {label[log.action] ?? log.action}
                <span className="text-muted-foreground"> · {formatDateTime(log.created_at)}</span>
              </p>
              {Object.entries(changes).map(([field, [before, after]]) => (
                <p key={field} className="text-muted-foreground">
                  {slot}
                  {FIELD_LABELS[field] ?? field}: <span className="line-through">{show(before)}</span> →{" "}
                  <span className="text-foreground">{show(after)}</span>
                </p>
              ))}
            </li>
          );
        })}
        {logs.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
      </ul>
    </section>
  );
}
