"use client";

import { Film, FileSignature, Paperclip, Receipt, Tv, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { DEAL_TYPE_LABELS, SLOT_STATUS_LABELS, formatDate } from "@/lib/deals";
import { money } from "@/lib/finance";
import type { AuditLog, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  episode_ranges: "Episodes",
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
  draft: "Draft",
  terminated: "Terminated",
};

const DOC_KINDS: Record<string, string> = {
  contract: "signed contract",
  annexure: "annexure",
  rights_evidence: "rights evidence",
  invoice: "invoice",
  other: "file",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && VALUE_LABELS[value]) return VALUE_LABELS[value];
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
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

type Kind = "deal" | "slots" | "payments" | "expenses" | "episodes" | "documents";

const KINDS: Record<Kind, { icon: typeof Tv; dot: string }> = {
  deal: { icon: FileSignature, dot: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400" },
  slots: { icon: Tv, dot: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400" },
  payments: { icon: Wallet, dot: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" },
  expenses: { icon: Receipt, dot: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" },
  episodes: { icon: Film, dot: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" },
  documents: { icon: Paperclip, dot: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300" },
};

const FILTERS: [string, string, Kind[]][] = [
  ["all", "All", ["deal", "slots", "payments", "expenses", "episodes", "documents"]],
  ["payments", "Payments & expenses", ["payments", "expenses"]],
  ["slots", "Channels & slots", ["slots"]],
  ["deal", "Deal changes", ["deal"]],
  ["files", "Episodes & files", ["episodes", "documents"]],
];

type Entry = { kind: Kind; title: string; lines: string[] };

/** Turn an audit log row into a sentence a founder can read. */
function describe(log: AuditLog, cur: string): Entry {
  const d = log.details as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : undefined);
  const amt = (k: string) => (s(k) ? money(s(k), cur) : "");
  const changes = (d.changes ?? {}) as Record<string, [unknown, unknown]>;
  const changeLines = Object.entries(changes).map(([f, [a, b]]) => `${FIELD_LABELS[f] ?? f}: ${show(a)} → ${show(b)}`);
  const slot = s("slot") ?? "";
  const [before, after] = (changes.channel ?? [null, null]) as [string | null, string | null];
  const from = s("effective_date") ? `from ${formatDate(s("effective_date")!)}` : "";
  const note = s("notes") ? `Note: ${s("notes")}` : "";

  switch (log.action) {
    case "deal.created":
      return {
        kind: "deal",
        title: "Deal created",
        lines: [
          [s("deal_type") ? VALUE_LABELS[s("deal_type")!] : "", s("fee")?.replace(/^([A-Z]{3}) ([\d.]+)$/, (_, c, n) => money(n, c))]
            .filter(Boolean)
            .join(" · "),
          s("term")?.replace(/\d{4}-\d{2}-\d{2}/g, (x) => formatDate(x)) ?? "",
          s("slots") ?? "",
        ].filter(Boolean),
      };
    case "deal.updated":
      return { kind: "deal", title: "Deal details changed", lines: changeLines };
    case "slot.assigned":
      return { kind: "slots", title: `${after} assigned to ${slot}`, lines: [from, note].filter(Boolean) };
    case "slot.replaced":
      return { kind: "slots", title: `${slot}: ${before} replaced by ${after}`, lines: [from, note && note.replace("Note", "Reason")].filter(Boolean) };
    case "slot.unassigned":
      return { kind: "slots", title: `${before} removed from ${slot}`, lines: [from.replace("from", "on"), note].filter(Boolean) };
    case "slot.updated":
      return { kind: "slots", title: `${slot} updated`, lines: changeLines };
    case "deal.installment_added":
      return { kind: "payments", title: `Installment of ${amt("amount")} added`, lines: [`Due ${show(s("due"))}`] };
    case "deal.installment_paid":
      return {
        kind: "payments",
        title: `Installment paid${s("paid") ? `: ${amt("paid")}` : ""}`,
        lines: [
          [`Due ${show(s("due"))}`, s("paid_on") ? `paid on ${show(s("paid_on"))}` : ""].filter(Boolean).join(" · "),
          s("reference") ? `Reference: ${s("reference")}` : "",
        ].filter(Boolean),
      };
    case "deal.installment_unpaid":
      return { kind: "payments", title: "Installment marked as not paid", lines: [`Due ${show(s("due"))}`] };
    case "deal.installment_deleted":
      return { kind: "payments", title: `Installment of ${amt("amount")} deleted`, lines: [`Was due ${show(s("due"))}`] };
    case "deal.expense_added":
      return { kind: "expenses", title: `Expense of ${amt("amount")} added`, lines: [s("description") ?? ""] };
    case "deal.expense_deleted":
      return { kind: "expenses", title: `Expense of ${amt("amount")} deleted`, lines: [s("description") ?? ""] };
    case "episode.added":
      return { kind: "episodes", title: "Episode details added", lines: [s("name") ?? ""] };
    case "episode.updated":
      return { kind: "episodes", title: "Episode details edited", lines: [s("name") ?? ""] };
    case "episode.deleted":
      return { kind: "episodes", title: "Episode details deleted", lines: [s("name") ?? ""] };
    case "episode.imported":
      return {
        kind: "episodes",
        title: "Episodes imported from a file",
        lines: [`${s("name") ?? ""} · ${d.created ?? 0} new, ${d.updated ?? 0} updated`],
      };
    case "document.uploaded":
      return { kind: "documents", title: `Uploaded ${DOC_KINDS[s("kind") ?? "other"] ?? "file"}`, lines: [s("name") ?? ""] };
    case "document.deleted":
      return { kind: "documents", title: "Deleted a file", lines: [s("name") ?? ""] };
    default:
      return { kind: "deal", title: log.action, lines: changeLines };
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Everything that happened on this deal, newest first, as a timeline. */
export function DealActivity({ dealId, refreshKey, currency = "INR" }: { dealId: string; refreshKey: number; currency?: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");

  const load = useCallback(
    (p: number) => {
      api<Page<AuditLog>>(`/audit-logs?entity_type=deal&entity_id=${dealId}&page=${p}&page_size=30`)
        .then((res) => {
          setLogs((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
          setTotal(res.total);
          setPage(p);
        })
        .catch(() => {});
    },
    [dealId],
  );
  useEffect(() => load(1), [load, refreshKey]);

  const kinds = FILTERS.find(([k]) => k === filter)![2];
  const entries = logs.map((log) => ({ log, e: describe(log, currency) })).filter(({ e }) => kinds.includes(e.kind));
  const groups: [string, typeof entries][] = [];
  for (const item of entries) {
    const label = dayLabel(item.log.created_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">History</h3>
          <p className="text-sm text-muted-foreground">Everything that happened on this deal, newest first. Nothing is ever erased.</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-8">
        {groups.map(([day, items]) => (
          <div key={day}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{day}</p>
            <ol className="relative">
              {items.map(({ log, e }, i) => {
                const K = KINDS[e.kind];
                return (
                  <li key={log.id} className="relative flex gap-4 pb-6 last:pb-0">
                    {i < items.length - 1 && <span aria-hidden className="absolute left-[17px] top-10 h-[calc(100%-2.5rem)] w-0.5 bg-border" />}
                    <span className={cn("z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-card", K.dot)}>
                      <K.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="font-semibold">{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {time(log.created_at)} · {log.user_name ?? "System"}
                        </p>
                      </div>
                      {e.lines.map((line) => (
                        <p key={line} className="text-sm text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      </div>

      {logs.length < total && (
        <div className="mt-6 text-center">
          <Button variant="outline" onClick={() => load(page + 1)}>
            Show older ({total - logs.length} more)
          </Button>
        </div>
      )}
    </section>
  );
}
