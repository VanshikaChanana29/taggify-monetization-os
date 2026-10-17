"use client";

import { ArrowLeft, CheckCircle2, ExternalLink, Pencil, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { type SlotAction, SlotAssignPanel } from "@/components/slot-assign-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  COUNTRY_NAMES,
  DEAL_STATUS_LABELS,
  DEAL_STATUS_TONES,
  DEAL_TYPE_LABELS,
  SLOT_STATUS_LABELS,
  dealValue,
  episodeSummary,
  formatDate,
  todayISO,
} from "@/lib/deals";
import { formatDateTime } from "@/lib/format";
import type { AuditLog, Deal, Page, Platform, RightsResult, Slot, SlotHistoryItem, SlotStatus } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";

const SLOT_SORT = {
  code: (s: Slot) => `${s.platform === "youtube" ? 0 : 1}-${String(s.number).padStart(3, "0")}`,
  status: (s: Slot) => SLOT_STATUS_LABELS[s.status],
};

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
  channel: "Channel",
};

const VALUE_LABELS: Record<string, string> = { ...SLOT_STATUS_LABELS, ...DEAL_TYPE_LABELS };

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

function InfoCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function RightsChecker({ deal }: { deal: Deal }) {
  const [platform, setPlatform] = useState<Platform>(deal.yt_slot_limit ? "youtube" : "facebook");
  const [onDate, setOnDate] = useState(todayISO());
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [territory, setTerritory] = useState(deal.territories[0] ?? "");
  const [result, setResult] = useState<RightsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setResult(
        await api<RightsResult>(`/deals/${deal.id}/check-rights`, {
          method: "POST",
          json: {
            platform,
            on_date: onDate || null,
            season: season ? Number(season) : null,
            episode: episode ? Number(episode) : null,
            territory: territory || null,
          },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Rights check</h3>
      </div>
      <p className="text-sm text-muted-foreground">Can this content be published here, on this date?</p>
      <form onSubmit={check} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rc-platform">Platform</Label>
          <NativeSelect id="rc-platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            <option value="youtube">YouTube</option>
            <option value="facebook">Facebook</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rc-date">Date</Label>
          <Input id="rc-date" type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </div>
        {deal.episode_scope === "seasons" && (
          <div className="space-y-1">
            <Label htmlFor="rc-season">Season</Label>
            <Input id="rc-season" type="number" min="1" value={season} onChange={(e) => setSeason(e.target.value)} />
          </div>
        )}
        {deal.episode_scope !== "all" && (
          <div className="space-y-1">
            <Label htmlFor="rc-episode">Episode</Label>
            <Input id="rc-episode" type="number" min="1" value={episode} onChange={(e) => setEpisode(e.target.value)} />
          </div>
        )}
        {!deal.is_worldwide && (
          <div className="space-y-1">
            <Label htmlFor="rc-territory">Territory</Label>
            <NativeSelect id="rc-territory" value={territory} onChange={(e) => setTerritory(e.target.value)}>
              {Object.entries(COUNTRY_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex items-end">
          <Button type="submit" className="w-full">
            Check
          </Button>
        </div>
      </form>
      {error && <div className="mt-4"><Notice kind="error">{error}</Notice></div>}
      {result && (
        <div
          className={
            result.allowed
              ? "mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          }
        >
          <p className="flex items-center gap-2 font-semibold">
            {result.allowed ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            {result.allowed ? "Allowed" : "Not allowed"} · {formatDate(result.checked_on)}
          </p>
          {result.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function DealActivity({ dealId, refreshKey }: { dealId: string; refreshKey: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => {
    api<Page<AuditLog>>(`/audit-logs?entity_type=deal&entity_id=${dealId}&page_size=20`)
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

function SlotHistory({ dealId, refreshKey }: { dealId: string; refreshKey: number }) {
  const [rows, setRows] = useState<SlotHistoryItem[]>([]);
  useEffect(() => {
    api<SlotHistoryItem[]>(`/deals/${dealId}/assignments`).then(setRows).catch(() => {});
  }, [dealId, refreshKey]);
  const ended: Record<string, string> = { replaced: "Replaced", unassigned: "Removed" };
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="p-6 pb-4">
        <h3 className="text-lg font-semibold">Slot history</h3>
        <p className="text-sm text-muted-foreground">Every channel that has held a slot in this deal. Nothing is ever deleted.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Slot</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>How</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-mono font-semibold">{h.slot_code}</TableCell>
              <TableCell>
                <Link href={`/channels/${h.channel_id}`} className="font-medium hover:text-primary">
                  {h.channel_name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(h.start_date)}</TableCell>
              <TableCell className="whitespace-nowrap">{h.end_date ? formatDate(h.end_date) : "Now"}</TableCell>
              <TableCell className="text-muted-foreground">
                {h.start_reason === "replacement" ? "Replacement" : "Assigned"}
                {h.end_reason && ` · ${ended[h.end_reason]}`}
                {h.notes && <span className="block text-xs">{h.notes}</span>}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={5}>No channel has held a slot yet.</EmptyRow>}
        </TableBody>
      </Table>
    </section>
  );
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activityKey, setActivityKey] = useState(0);
  const [acting, setActing] = useState<{ slotId: string; action: SlotAction } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Deal>(`/deals/${id}`)
      .then(setDeal)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  const slots = (deal?.slots ?? []).filter(
    (s) => (!platformFilter || s.platform === platformFilter) && (!statusFilter || s.status === statusFilter),
  );
  const table = useClientTable({
    rows: slots,
    sortBy: SLOT_SORT,
    initialSort: { key: "code", dir: "asc" },
    resetKey: `${platformFilter}|${statusFilter}`,
  });

  async function updateSlot(slot: Slot, change: { status?: SlotStatus; notes?: string }) {
    const body = { status: change.status ?? slot.status, notes: change.notes ?? slot.notes };
    if (body.status === slot.status && (body.notes ?? "") === (slot.notes ?? "")) return;
    try {
      const saved = await api<Slot>(`/deals/${id}/slots/${slot.id}`, { method: "PATCH", json: body });
      setDeal((d) => (d ? { ...d, slots: d.slots.map((s) => (s.id === saved.id ? saved : s)) } : d));
      setActivityKey((k) => k + 1);
      load();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : "Could not update slot");
    }
  }

  if (error && !deal) return <Notice kind="error">{error}</Notice>;
  if (!deal) return <p className="text-muted-foreground">Loading…</p>;

  const years = `${deal.term_start.slice(0, 4)}–${deal.term_end.slice(0, 4)}`;

  return (
    <div className="space-y-8">
      <Link href="/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        All deals
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{deal.owner_name}</p>
          <h1 className="text-3xl font-bold tracking-tight">{deal.title}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Pill tone={DEAL_STATUS_TONES[deal.status]}>{DEAL_STATUS_LABELS[deal.status]}</Pill>
            <span className="text-sm text-muted-foreground">{DEAL_TYPE_LABELS[deal.deal_type]}</span>
          </div>
        </div>
        <Button size="lg" variant="outline" asChild>
          <Link href={`/deals/${deal.id}/edit`}>
            <Pencil />
            Edit deal
          </Link>
        </Button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <InfoCard label="Licence value" value={dealValue(deal)} />
        <InfoCard label="Episodes" value={episodeSummary(deal.episode_scope, deal.episode_ranges)} />
        <InfoCard label="Term" value={years} sub={`${formatDate(deal.term_start)} → ${formatDate(deal.term_end)}`} />
        <InfoCard
          label="YouTube slots"
          value={deal.yt_slot_limit ? `${deal.yt_slots_used} / ${deal.yt_slot_limit} in use` : "None"}
        />
        <InfoCard
          label="Facebook slots"
          value={deal.fb_slot_limit ? `${deal.fb_slots_used} / ${deal.fb_slot_limit} in use` : "None"}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Slots</h3>
            <p className="text-sm text-muted-foreground">Which channel holds each authorised slot. Replacing keeps the old channel&apos;s history.</p>
          </div>
          <div className="flex gap-2">
            <NativeSelect aria-label="Filter slots by platform" className="w-36" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="">All platforms</option>
              <option value="youtube">YouTube</option>
              <option value="facebook">Facebook</option>
            </NativeSelect>
            <NativeSelect aria-label="Filter slots by status" className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(SLOT_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Slot" sortKey="code" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Destination</TableHead>
              <TableHead>CMS</TableHead>
              <TableHead>Manager</TableHead>
              <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Channel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((s) => (
              <Fragment key={s.id}>
                <TableRow>
                  <TableCell className="font-mono font-semibold">{s.code}</TableCell>
                  <TableCell>
                    {s.channel_id ? (
                      <>
                        <Link href={`/channels/${s.channel_id}`} className="font-medium hover:text-primary">
                          {s.channel_name}
                        </Link>
                        <p className="text-xs text-muted-foreground">since {s.since ? formatDate(s.since) : "—"}</p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{s.status === "reserved" ? "Empty — reserved" : "Empty"}</span>
                    )}
                  </TableCell>
                  <TableCell>{s.cms_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{s.manager_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Status of ${s.code}`}
                      className="h-9 w-44"
                      value={s.status}
                      onChange={(e) => updateSlot(s, { status: e.target.value as SlotStatus })}
                    >
                      {Object.entries(SLOT_STATUS_LABELS)
                        .filter(([v]) => v !== "replaced")
                        .map(([v, l]) => (
                          <option key={v} value={v} disabled={s.channel_id ? v === "unassigned" : v === "pending_whitelist" || v === "active"}>
                            {l}
                          </option>
                        ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Notes for ${s.code}`}
                      className="h-9 min-w-40"
                      defaultValue={s.notes ?? ""}
                      placeholder="Add a note…"
                      onBlur={(e) => updateSlot(s, { notes: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {s.channel_id ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setActing({ slotId: s.id, action: "replace" })}>
                          Replace
                        </Button>{" "}
                        <Button variant="ghost" size="sm" onClick={() => setActing({ slotId: s.id, action: "unassign" })}>
                          Remove
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => setActing({ slotId: s.id, action: "assign" })}>
                        Assign
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {acting?.slotId === s.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7}>
                      <SlotAssignPanel
                        dealId={deal.id}
                        slot={s}
                        action={acting.action}
                        onCancel={() => setActing(null)}
                        onDone={(message) => {
                          setActing(null);
                          setNotice(message);
                          setError(null);
                          setActivityKey((k) => k + 1);
                          load();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {table.total === 0 && <EmptyRow colSpan={7}>No slots match these filters.</EmptyRow>}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="slots"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SlotHistory dealId={deal.id} refreshKey={activityKey} />
          <DealActivity dealId={deal.id} refreshKey={activityKey} />
        </div>

        <div className="space-y-6">
          <RightsChecker deal={deal} />
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Terms</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Territory</dt>
                <dd className="text-right font-medium">
                  {deal.is_worldwide ? "Worldwide" : deal.territories.map((t) => COUNTRY_NAMES[t] ?? t).join(", ")}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-3">
                <dt className="text-muted-foreground">Contract</dt>
                <dd>
                  {deal.contract_url ? (
                    <a href={deal.contract_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-3">
                <dt className="text-muted-foreground">Owner contact</dt>
                <dd className="text-right">
                  {deal.owner_contact_name ?? "—"}
                  {deal.owner_contact_email && <span className="block text-muted-foreground">{deal.owner_contact_email}</span>}
                </dd>
              </div>
              {deal.notes && (
                <div className="border-t pt-3">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{deal.notes}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
