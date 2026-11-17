"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/deals";
import { PLATFORM_LABELS } from "@/lib/people";
import type { ChannelListItem, Page, Slot } from "@/lib/types";

async function allActiveChannels(platform: Slot["platform"]): Promise<ChannelListItem[]> {
  const out: ChannelListItem[] = [];
  for (let page = 1; ; page++) {
    const p = await api<Page<ChannelListItem>>(`/channels?platform=${platform}&status=active&page_size=100&page=${page}`);
    out.push(...p.items);
    if (p.items.length < 100 || out.length >= p.total) return out;
  }
}

/** Popup body: tick several channels at once; they fill the chosen empty slots in order. */
export function BulkAssignPanel({
  dealId,
  slots,
  onDone,
  onCancel,
}: {
  dealId: string;
  /** Empty slots of one platform, in the order they should be filled. */
  slots: Slot[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const platform = slots[0].platform;
  const [channels, setChannels] = useState<ChannelListItem[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(true);
  const [status, setStatus] = useState("pending_whitelist");
  const [effective, setEffective] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    allActiveChannels(platform)
      // A channel can hold only one slot per deal, so hide the ones already in this deal.
      .then((list) => setChannels(list.filter((c) => !c.slots.some((s) => s.deal_id === dealId))))
      .catch(() => setChannels([]));
  }, [platform, dealId]);

  const q = query.trim().toLowerCase();
  const shown = (channels ?? []).filter(
    (c) =>
      (!freeOnly || c.slots.length === 0 || picked.includes(c.id)) &&
      (!q || c.name.toLowerCase().includes(q) || c.external_id.toLowerCase().includes(q)),
  );
  const full = picked.length >= slots.length;
  const byId = new Map((channels ?? []).map((c) => [c.id, c]));

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < slots.length ? [...p, id] : p));
  }

  function pickShown() {
    setPicked((p) => {
      const next = [...p];
      for (const c of shown) {
        if (next.length >= slots.length) break;
        if (!next.includes(c.id)) next.push(c.id);
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (picked.length === 0) return;
    setError(null);
    setSaving(true);
    try {
      await api(`/deals/${dealId}/slots/bulk-assign`, {
        method: "POST",
        json: {
          assignments: picked.map((channel_id, i) => ({ slot_id: slots[i].id, channel_id })),
          status,
          effective_date: effective,
          notes: notes || null,
        },
      });
      onDone(`${picked.length} channel${picked.length === 1 ? "" : "s"} assigned.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign the channels");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="bulk-q">
              Pick up to {slots.length} {PLATFORM_LABELS[platform]} channel{slots.length === 1 ? "" : "s"}
            </Label>
            <span className="text-xs text-muted-foreground">
              {picked.length} / {slots.length}
            </span>
          </div>
          <Input id="bulk-q" placeholder="Search name or ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={freeOnly}
                onChange={(e) => setFreeOnly(e.target.checked)}
              />
              Only channels not in any deal
            </label>
            <span className="flex gap-3">
              <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={full || shown.length === 0} onClick={pickShown}>
                Select shown
              </button>
              <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={picked.length === 0} onClick={() => setPicked([])}>
                Clear
              </button>
            </span>
          </div>
          <div className="h-72 overflow-y-auto rounded-lg border">
            {channels === null && <p className="p-3 text-sm text-muted-foreground">Loading channels…</p>}
            {channels !== null && shown.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No matching active {PLATFORM_LABELS[platform]} channels.{" "}
                <Link href="/channels" className="text-primary hover:underline">
                  Add one
                </Link>
                .
              </p>
            )}
            {shown.map((c) => {
              const on = picked.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-start gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40 ${!on && full ? "opacity-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={on}
                    disabled={!on && full}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.cms_name ?? "No CMS"}
                      {c.slots.length ? ` · in ${c.slots.map((s) => `${s.deal_title} ${s.slot_code}`).join(", ")}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <Label>Goes into</Label>
          <ol className="max-h-[23rem] overflow-y-auto rounded-lg border text-sm">
            {slots.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                <span className="w-14 shrink-0 font-mono font-semibold">{s.code}</span>
                {picked[i] ? (
                  <span className="truncate font-medium">{byId.get(picked[i])?.name}</span>
                ) : (
                  <span className="text-muted-foreground">Stays empty</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-1">
          <Label htmlFor="bulk-st">
            Status <InfoTip text={HELP.slotStatus} />
          </Label>
          <NativeSelect id="bulk-st" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending_whitelist">Pending whitelist</option>
            <option value="reserved">Reserved</option>
            <option value="active">Active (already approved)</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bulk-dt">
            From date <InfoTip text={HELP.effectiveDate} />
          </Label>
          <Input id="bulk-dt" type="date" max={todayISO()} value={effective} onChange={(e) => setEffective(e.target.value)} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="bulk-nt">Note (same for all)</Label>
          <Input id="bulk-nt" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || picked.length === 0}>
          Assign {picked.length || ""} channel{picked.length === 1 ? "" : "s"}
        </Button>
      </div>
    </form>
  );
}
