"use client";

import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { EXTERNAL_ID_HINT } from "@/lib/people";
import type { ChannelListItem, CmsPartner, Platform } from "@/lib/types";

type Form = {
  platform: Platform;
  name: string;
  external_id: string;
  url: string;
  cms_partner_id: string;
  status: "active" | "inactive";
  notes: string;
};

/** Create (channel = null) or edit a channel. */
export function ChannelForm({
  channel,
  notes,
  onSaved,
  onCancel,
}: {
  channel: ChannelListItem | null;
  notes?: string | null;
  onSaved: (saved: ChannelListItem) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Form>({
    platform: channel?.platform ?? "youtube",
    name: channel?.name ?? "",
    external_id: channel?.external_id ?? "",
    url: channel?.url ?? "",
    cms_partner_id: channel?.cms_partner_id ?? "",
    status: channel?.status ?? "active",
    notes: notes ?? "",
  });
  const [cmsList, setCmsList] = useState<CmsPartner[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CmsPartner[]>("/cms-partners").then(setCmsList).catch(() => {});
  }, []);

  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));
  const cmsOptions = cmsList.filter(
    (c) => c.platform === form.platform && (c.is_active || c.id === channel?.cms_partner_id),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await api<ChannelListItem>(channel ? `/channels/${channel.id}` : "/channels", {
        method: channel ? "PUT" : "POST",
        json: { ...form, cms_partner_id: form.cms_partner_id || null, url: form.url || null, notes: form.notes || null },
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the channel");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border bg-card p-6 shadow-sm md:grid-cols-2">
      <h3 className="text-lg font-semibold md:col-span-2">{channel ? `Edit ${channel.name}` : "New channel / page"}</h3>
      <div className="space-y-2">
        <Label htmlFor="ch-platform">Platform *</Label>
        <NativeSelect
          id="ch-platform"
          value={form.platform}
          onChange={(e) => set({ platform: e.target.value as Platform, cms_partner_id: "" })}
        >
          <option value="youtube">YouTube channel</option>
          <option value="facebook">Facebook page</option>
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ch-name">Name *</Label>
        <Input id="ch-name" required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ch-external">{form.platform === "youtube" ? "Channel ID" : "Page ID"} * <InfoTip text={HELP.externalId} /></Label>
        <Input
          id="ch-external"
          required
          placeholder={EXTERNAL_ID_HINT[form.platform]}
          value={form.external_id}
          onChange={(e) => set({ external_id: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ch-url">Link</Label>
        <Input id="ch-url" type="url" placeholder="https://…" value={form.url} onChange={(e) => set({ url: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ch-cms">{form.platform === "youtube" ? "CMS" : "Business portfolio"} <InfoTip text={HELP.cms} /></Label>
        <NativeSelect id="ch-cms" value={form.cms_partner_id} onChange={(e) => set({ cms_partner_id: e.target.value })}>
          <option value="">None yet</option>
          {cmsOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ch-status">Status</Label>
        <NativeSelect id="ch-status" value={form.status} onChange={(e) => set({ status: e.target.value as Form["status"] })}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="ch-notes">Notes</Label>
        <Input id="ch-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      {error && (
        <div className="md:col-span-2">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      <div className="flex gap-3 md:col-span-2">
        <Button type="submit">{channel ? "Save changes" : "Create channel"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
