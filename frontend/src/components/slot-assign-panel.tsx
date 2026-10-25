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

export type SlotAction = "assign" | "replace" | "unassign";

const TITLES: Record<SlotAction, string> = {
  assign: "Assign a channel to",
  replace: "Replace the channel on",
  unassign: "Remove the channel from",
};

export function slotActionTitle(action: SlotAction, slot: Slot): string {
  return `${TITLES[action]} ${slot.code}`;
}

/** Popup body: pick a channel (assign/replace) or confirm removal. */
export function SlotAssignPanel({
  dealId,
  slot,
  action,
  onDone,
  onCancel,
}: {
  dealId: string;
  slot: Slot;
  action: SlotAction;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [channels, setChannels] = useState<ChannelListItem[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [status, setStatus] = useState("pending_whitelist");
  const [effective, setEffective] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (action === "unassign") return;
    api<Page<ChannelListItem>>(`/channels?platform=${slot.platform}&status=active&page_size=100`)
      .then((p) => setChannels(p.items.filter((c) => c.id !== slot.channel_id)))
      .catch(() => setChannels([]));
  }, [action, slot.platform, slot.channel_id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/deals/${dealId}/slots/${slot.id}/${action}`, {
        method: "POST",
        json:
          action === "unassign"
            ? { effective_date: effective, notes: notes || null }
            : { channel_id: channelId, status, effective_date: effective, notes: notes || null },
      });
      const picked = channels?.find((c) => c.id === channelId)?.name;
      onDone(
        action === "unassign"
          ? `${slot.channel_name} removed from ${slot.code}.`
          : `${picked} now holds ${slot.code}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the slot");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {action !== "unassign" && (
          <>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor={`ch-${slot.id}`}>{PLATFORM_LABELS[slot.platform]} channel *</Label>
              <NativeSelect id={`ch-${slot.id}`} required value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                <option value="">{channels === null ? "…" : "Select a channel…"}</option>
                {channels?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.slots.length ? ` (in ${c.slots.map((s) => `${s.deal_title} ${s.slot_code}`).join(", ")})` : ""}
                  </option>
                ))}
              </NativeSelect>
              {channels?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active {PLATFORM_LABELS[slot.platform]} channels.{" "}
                  <Link href="/channels" className="text-primary hover:underline">
                    Add one
                  </Link>
                  .
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`st-${slot.id}`}>Status <InfoTip text={HELP.slotStatus} /></Label>
              <NativeSelect id={`st-${slot.id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="pending_whitelist">Pending whitelist</option>
                <option value="reserved">Reserved</option>
                <option value="active">Active (already approved)</option>
              </NativeSelect>
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor={`dt-${slot.id}`}>{action === "unassign" ? "Removed on" : "From date"} <InfoTip text={HELP.effectiveDate} /></Label>
          <Input id={`dt-${slot.id}`} type="date" max={todayISO()} value={effective} onChange={(e) => setEffective(e.target.value)} />
        </div>
        <div className={action === "unassign" ? "space-y-1 md:col-span-3" : "space-y-1 md:col-span-4"}>
          <Label htmlFor={`nt-${slot.id}`}>{action === "replace" ? "Reason (recommended)" : "Note"}</Label>
          <Input
            id={`nt-${slot.id}`}
            placeholder={action === "replace" ? "e.g. old channel got a copyright strike" : ""}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      {action === "replace" && (
        <p className="text-xs text-muted-foreground">
          The old channel&apos;s record, CMS, manager and revenue history are kept. The new channel waits for approval unless you mark it Active.
        </p>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant={action === "unassign" ? "destructive" : "default"} disabled={saving}>
          {action === "assign" ? "Assign" : action === "replace" ? "Replace" : "Remove channel"}
        </Button>
      </div>
    </form>
  );
}
