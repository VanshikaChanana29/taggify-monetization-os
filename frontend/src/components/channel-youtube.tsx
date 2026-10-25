"use client";

import { BarChart3, Link2, RefreshCw, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import type { ChannelYouTube, YouTubeConnectResult } from "@/lib/types";
import { firstOfMonth, shortDate, yesterday, YT_STATUS } from "@/lib/youtube";

/** A YouTube channel's connection and its last 30 days of revenue, views and watch time. */
export function ChannelYouTubeCard({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [data, setData] = useState<ChannelYouTube | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState(firstOfMonth());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(() => {
    api<ChannelYouTube>(`/channels/${channelId}/youtube`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load"));
  }, [channelId]);

  useEffect(load, [load]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("fetch_from", from);
      const out = await api<YouTubeConnectResult>(`/channels/${channelId}/youtube-token`, { method: "POST", form });
      setNotice(
        `${out.connected ? "Connected" : "Permission updated"}. ${out.sync_started ? `Fetching data from ${shortDate(from)}; refresh in a minute.` : ""}`,
      );
      setAdding(false);
      setFile(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setError(null);
    try {
      await api("/youtube/sync", { method: "POST", json: { channel_id: channelId } });
      setNotice("Sync started; refresh in a minute.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the sync");
    }
  }

  async function disconnect() {
    setError(null);
    try {
      await api(`/channels/${channelId}/youtube-token`, { method: "DELETE" });
      setConfirmRemove(false);
      setNotice("Disconnected. Revenue already saved stays.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    }
  }

  const status = data?.status ?? "not_connected";
  const totals = (data?.days ?? []).reduce(
    (acc, d) => ({
      revenue: acc.revenue + (d.currency === "USD" ? Number(d.revenue ?? 0) : 0),
      views: acc.views + (d.views ?? 0),
      minutes: acc.minutes + (d.watch_minutes ?? 0),
    }),
    { revenue: 0, views: 0, minutes: 0 },
  );

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">YouTube: last 30 days</h3>
          <Pill tone={YT_STATUS[status].tone}>{YT_STATUS[status].label}</Pill>
        </div>
        <div className="flex flex-wrap gap-2">
          {status !== "not_connected" && (
            <Button size="sm" variant="outline" onClick={syncNow}>
              <RefreshCw />
              Sync now
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            <Link2 />
            {status === "not_connected" ? "Add token file" : "Replace token file"}
          </Button>
          {status !== "not_connected" && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
              <Unlink />
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="info">{notice}</Notice>}
      {data?.last_error && <Notice kind="warning">{data.last_error}</Notice>}

      {confirmRemove && (
        <Notice kind="warning">
          Disconnect {channelName}? Daily data stops; revenue already saved stays.{" "}
          <button type="button" className="font-semibold underline" onClick={disconnect}>
            Yes, disconnect
          </button>{" "}
          ·{" "}
          <button type="button" className="underline" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
        </Notice>
      )}

      {adding && (
        <form onSubmit={connect} className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="yt-token">This channel&apos;s token file (.json)</Label>
            <input
              id="yt-token"
              type="file"
              accept=".json"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-card file:px-3 file:py-2 file:text-sm file:font-semibold"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="yt-from-one">Data from</Label>
            <Input id="yt-from-one" type="date" value={from} max={yesterday()} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <Button type="submit" disabled={!file || busy}>
            {busy ? "Checking…" : "Connect"}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            YouTube is asked which channel the file is for; it must be this channel&apos;s ID.
          </p>
        </form>
      )}

      {status !== "not_connected" && data && (
        <p className="text-sm text-muted-foreground">
          {data.youtube_title && <>On YouTube: <b className="text-foreground">{data.youtube_title}</b> · </>}
          {data.subscribers !== null && <>{data.subscribers.toLocaleString("en-IN")} subscribers · </>}
          {data.videos !== null && <>{data.videos.toLocaleString("en-IN")} videos · </>}
          Data {shortDate(data.data_from)} – {shortDate(data.data_to)} · Last sync {formatDateTime(data.last_synced_at)}
        </p>
      )}

      {data && data.days.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Revenue (USD)</p>
              <p className="text-lg font-semibold tabular-nums">{money(totals.revenue, "USD")}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Views</p>
              <p className="text-lg font-semibold tabular-nums">{totals.views.toLocaleString("en-IN")}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Watch hours</p>
              <p className="text-lg font-semibold tabular-nums">{Math.round(totals.minutes / 60).toLocaleString("en-IN")}</p>
            </div>
          </div>
          <div className="max-h-72 overflow-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Views</TableHead>
                  <TableHead>Watch hrs</TableHead>
                  <TableHead>Subs +/−</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="text-sm">{shortDate(d.day)}</TableCell>
                    <TableCell className="tabular-nums">
                      {money(d.revenue, d.currency)}
                      {d.state && <span className="ml-1 text-xs text-muted-foreground">{d.state === "final" ? "final (CMS)" : "estimate"}</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{d.views?.toLocaleString("en-IN") ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{d.watch_minutes === null ? "—" : Math.round(d.watch_minutes / 60).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="tabular-nums">
                      {d.subscribers_gained === null ? "—" : `+${d.subscribers_gained} / −${d.subscribers_lost ?? 0}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "not_connected"
            ? "Add this channel's token file to bring in revenue, views and watch time every day."
            : "No data yet. The first sync may still be running."}
        </p>
      )}
    </section>
  );
}
