"use client";

import { Check, FileUp, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { EXTERNAL_ID_HINT } from "@/lib/people";
import { cn } from "@/lib/utils";
import type { ChannelListItem, CmsPartner, Platform, DealPartner } from "@/lib/types";

type Form = {
  platform: Platform;
  name: string;
  external_id: string;
  url: string;
  cms_partner_id: string;
  partner_id: string;
  status: "active" | "inactive";
  notes: string;
};

const PLATFORM_CHOICES = [
  ["youtube", "YouTube channel", "Data can come in by itself"],
  ["facebook", "Facebook page", "Revenue from the CMS sheet"],
] as const;

/** Create (channel = null) or edit a channel. */
export function ChannelForm({
  channel,
  notes,
  onSaved,
  onCancel,
  inDialog = false,
}: {
  channel: ChannelListItem | null;
  notes?: string | null;
  onSaved: (saved: ChannelListItem) => void;
  onCancel: () => void;
  /** Inside a popup: no card frame or title of its own (the popup has them). */
  inDialog?: boolean;
}) {
  const [form, setForm] = useState<Form>({
    platform: channel?.platform ?? "youtube",
    name: channel?.name ?? "",
    external_id: channel?.external_id ?? "",
    url: channel?.url ?? "",
    cms_partner_id: channel?.cms_partner_id ?? "",
    partner_id: channel?.partner?.id ?? "",
    status: channel?.status ?? "active",
    notes: notes ?? "",
  });
  const [cmsList, setCmsList] = useState<CmsPartner[]>([]);
  const [partners, setPartners] = useState<DealPartner[]>([]);
  const [error, setError] = useState<string | null>(null);
  // New YouTube channel: an optional token file fills the ID and name, and connects it on save.
  const [tokenFile, setTokenFile] = useState<File | null>(null);
  const [tokenInfo, setTokenInfo] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<"idle" | "reading" | "ok" | "error">("idle");
  const [saving, setSaving] = useState(false);

  async function readToken(f: File | null) {
    setTokenFile(f);
    setTokenInfo(null);
    setTokenState(f ? "reading" : "idle");
    if (!f) return;
    try {
      const form = new FormData();
      form.append("file", f);
      const who = await api<{ channel_id: string; title: string | null }>("/youtube/identify", { method: "POST", form });
      setForm((f) => ({
        ...f,
        external_id: who.channel_id,
        name: f.name || who.title || f.name,
      }));
      setTokenInfo(`${who.title ?? "This channel"} · ${who.channel_id}`);
      setTokenState("ok");
    } catch (err) {
      setTokenFile(null);
      setTokenState("error");
      setTokenInfo(err instanceof Error ? err.message : "Could not read the token file");
    }
  }

  useEffect(() => {
    api<DealPartner[]>("/partners")
      .then(setPartners)
      .catch(() => {});
    api<CmsPartner[]>("/cms-partners")
      .then(setCmsList)
      .catch(() => {});
  }, []);

  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));
  const cmsOptions = cmsList.filter((c) => c.platform === form.platform && (c.is_active || c.id === channel?.cms_partner_id));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await api<ChannelListItem>(channel ? `/channels/${channel.id}` : "/channels", {
        method: channel ? "PUT" : "POST",
        json: {
          ...form,
          cms_partner_id: form.cms_partner_id || null,
          partner_id: form.partner_id || null,
          url: form.url || null,
          notes: form.notes || null,
        },
      });
      if (!channel && tokenFile && form.platform === "youtube") {
        const data = new FormData();
        data.append("file", tokenFile);
        try {
          await api(`/channels/${saved.id}/youtube-token`, {
            method: "POST",
            form: data,
          });
        } catch (err) {
          setError(`Channel saved, but YouTube was not connected: ${err instanceof Error ? err.message : "error"}. Add the token on its page.`);
        }
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the channel");
    } finally {
      setSaving(false);
    }
  }

  const yt = form.platform === "youtube";
  const section = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <form onSubmit={submit} className={inDialog ? "space-y-6" : "space-y-6 rounded-2xl border bg-card p-6 shadow-sm"}>
      {!inDialog && <h3 className="text-lg font-semibold">{channel ? `Edit ${channel.name}` : "New channel / page"}</h3>}

      <div className="space-y-2">
        <p className={section}>Platform</p>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Platform">
          {PLATFORM_CHOICES.map(([value, title, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.platform === value}
              disabled={Boolean(channel)}
              onClick={() => set({ platform: value, cms_partner_id: "" })}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                form.platform === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white",
                  value === "youtube" ? "bg-red-600" : "bg-blue-600",
                )}
                aria-hidden
              >
                {value === "youtube" ? <Play className="h-4 w-4 fill-current" /> : <span className="text-lg font-bold leading-none">f</span>}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {!channel && yt && (
        <label
          htmlFor="ch-token"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            readToken(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "flex cursor-pointer items-center gap-4 rounded-xl border border-dashed p-4 transition-colors",
            tokenState === "ok" && "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
            tokenState === "error" && "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10",
            (tokenState === "idle" || tokenState === "reading") && "hover:border-primary hover:bg-primary/5",
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              tokenState === "ok" ? "bg-emerald-600 text-white" : tokenState === "error" ? "bg-red-600 text-white" : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {tokenState === "ok" ? (
              <Check className="h-5 w-5" />
            ) : tokenState === "error" ? (
              <X className="h-5 w-5" />
            ) : (
              <FileUp className="h-5 w-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {tokenState === "ok"
                ? "YouTube found the channel"
                : tokenState === "reading"
                  ? "Asking YouTube…"
                  : "Have the channel’s token file? (optional)"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {tokenInfo ??
                "Drop the .json here or click to choose. The channel ID and name fill in by themselves, and data starts coming in after saving."}
            </span>
          </span>
          {tokenState === "ok" && (
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                setTokenFile(null);
                setTokenInfo(null);
                setTokenState("idle");
              }}
            >
              Remove
            </button>
          )}
          <input id="ch-token" type="file" accept=".json" className="sr-only" onChange={(e) => readToken(e.target.files?.[0] ?? null)} />
        </label>
      )}

      <div className="space-y-3">
        <p className={section}>Channel</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ch-name">Name *</Label>
            <Input
              id="ch-name"
              required
              autoFocus
              placeholder={yt ? "e.g. CID Heroes" : "e.g. Kapil Shorts FB"}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ch-external">
              {yt ? "Channel ID" : "Page ID"} * <InfoTip text={HELP.externalId} />
            </Label>
            <Input
              id="ch-external"
              required
              className="font-mono"
              placeholder={EXTERNAL_ID_HINT[form.platform]}
              value={form.external_id}
              onChange={(e) => set({ external_id: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="ch-url">Link</Label>
            <Input
              id="ch-url"
              type="url"
              placeholder={yt ? "https://www.youtube.com/channel/UC…" : "https://www.facebook.com/…"}
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className={section}>Business</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ch-cms">
              {yt ? "CMS" : "Business portfolio"} <InfoTip text={HELP.cms} />
            </Label>
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
            <Label htmlFor="ch-partner">Owned by</Label>
            <NativeSelect id="ch-partner" value={form.partner_id} onChange={(e) => set({ partner_id: e.target.value })}>
              <option value="">Taggify</option>
              {partners
                .filter((p) => p.is_active || p.id === form.partner_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Deal partner: {p.name}
                  </option>
                ))}
            </NativeSelect>
            {form.partner_id && (
              <p className="text-xs text-muted-foreground">Its earnings after the CMS fee are paid to this partner; no Taggify incentive on it.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label id="ch-status-label">Status</Label>
            <div
              className="grid h-10 grid-cols-2 rounded-lg border bg-muted/40 p-1 text-sm font-medium"
              role="radiogroup"
              aria-labelledby="ch-status-label"
            >
              {(["active", "inactive"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={form.status === v}
                  onClick={() => set({ status: v })}
                  className={cn(
                    "rounded-md capitalize transition-colors",
                    form.status === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="ch-notes">Notes</Label>
            <textarea
              id="ch-notes"
              rows={2}
              placeholder="Anything worth remembering, e.g. waiting for Sony’s whitelist approval"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              className="flex w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {inDialog ? (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || tokenState === "reading"}>
            {saving ? "Saving…" : channel ? "Save changes" : "Create channel"}
          </Button>
        </DialogFooter>
      ) : (
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || tokenState === "reading"}>
            {saving ? "Saving…" : channel ? "Save changes" : "Create channel"}
          </Button>
        </div>
      )}
    </form>
  );
}
