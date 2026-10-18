"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api";
import { COUNTRY_NAMES, formatDate, todayISO } from "@/lib/deals";
import type { Deal, Platform, RightsResult } from "@/lib/types";

export function RightsChecker({ deal }: { deal: Deal }) {
  const [platform, setPlatform] = useState<Platform>(deal.yt_slot_limit ? "youtube" : "facebook");
  const [onDate, setOnDate] = useState(todayISO());
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [territory, setTerritory] = useState(deal.territories[0] ?? "");
  const [channelId, setChannelId] = useState("");
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
            channel_id: channelId || null,
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
      <p className="text-sm text-muted-foreground">
        Can this episode be published on this channel, on this date? Checks episode, term, territory and that the channel holds an
        approved slot (PDF slide 4).
      </p>
      <form onSubmit={check} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rc-platform">Platform</Label>
          <NativeSelect
            id="rc-platform"
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value as Platform);
              setChannelId("");
            }}
          >
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
        <div className="space-y-1">
          <Label htmlFor="rc-channel">Destination channel</Label>
          <NativeSelect id="rc-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Any (rights only)</option>
            {deal.slots
              .filter((s) => s.platform === platform && s.channel_id)
              .map((s) => (
                <option key={s.id} value={s.channel_id!}>
                  {s.channel_name} ({s.code})
                </option>
              ))}
          </NativeSelect>
        </div>
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
          {result.episode_title && <p className="mt-1 text-sm">Episode: {result.episode_title}</p>}
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
