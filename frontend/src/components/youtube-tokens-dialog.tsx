"use client";

import { CloudDownload, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES } from "@/lib/deals";
import { formatDateTime } from "@/lib/format";
import type { YouTubeConnectResult, YouTubeConnectRow, YouTubeSyncProgress } from "@/lib/types";
import { firstOfMonth, shortDate, yesterday } from "@/lib/youtube";

const RESULT: Record<YouTubeConnectRow["result"], { label: string; tone: string }> = {
  connected: { label: "Connected", tone: DEAL_STATUS_TONES.active },
  updated: { label: "Already connected", tone: DEAL_STATUS_TONES.upcoming },
  not_in_company: { label: "Not in this company", tone: DEAL_STATUS_TONES.expired },
  elsewhere: { label: "In another company", tone: DEAL_STATUS_TONES.draft },
  duplicate: { label: "Duplicate", tone: DEAL_STATUS_TONES.expired },
  unusable: { label: "Cannot use", tone: DEAL_STATUS_TONES.terminated },
};

/**
 * Connect channels from their owners' permission files (a .zip or .json files), and run the
 * YouTube sync. Files are matched to this company's channels by the ID YouTube reports.
 */
export function YouTubeTokensDialog({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fetchFrom, setFetchFrom] = useState(firstOfMonth());
  const [result, setResult] = useState<YouTubeConnectResult | null>(null);
  const [filter, setFilter] = useState("");
  const [historyFrom, setHistoryFrom] = useState(firstOfMonth());
  const [historyTo, setHistoryTo] = useState(yesterday());
  const [sync, setSync] = useState<YouTubeSyncProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSync = useCallback(() => {
    api<YouTubeSyncProgress>("/youtube/sync")
      .then(setSync)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) loadSync();
    else {
      setFiles([]);
      setResult(null);
      setError(null);
    }
  }, [open, loadSync]);

  // While a sync runs, check every few seconds; refresh the list when it ends.
  useEffect(() => {
    if (!open || !sync?.running) return;
    const timer = setInterval(() => {
      api<YouTubeSyncProgress>("/youtube/sync")
        .then((s) => {
          setSync(s);
          if (!s.running) onChanged();
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [open, sync?.running, onChanged]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("fetch_from", fetchFrom);
      const out = await api<YouTubeConnectResult>("/youtube/tokens", { method: "POST", form });
      setResult(out);
      setFilter("");
      loadSync();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function startSync(body: Record<string, string>) {
    setError(null);
    try {
      setSync(await api<YouTubeSyncProgress>("/youtube/sync", { method: "POST", json: body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the sync");
    }
  }

  const rows = result ? result.rows.filter((r) => !filter || r.result === filter) : [];
  const chips = result
    ? (
        [
          ["connected", result.connected],
          ["updated", result.updated],
          ["not_in_company", result.not_in_company],
          ["unusable", result.unusable],
          ["duplicate", result.duplicates],
          ["elsewhere", result.elsewhere],
        ] as const
      ).filter(([, n]) => n > 0)
    : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="YouTube data"
      description="Connect channels with their owners' permission files. Revenue, views, watch time and subscribers then come in every day by themselves."
    >
      <div className="space-y-5">
        {error && <Notice kind="error">{error}</Notice>}

        <form onSubmit={upload} className="space-y-3 rounded-xl border p-4">
          <p className="font-semibold">Connect channels</p>
          <p className="text-sm text-muted-foreground">
            Choose the .zip (or .json files). Each file is matched to a channel of this company by the channel ID YouTube
            reports for it. For channels not in this company nothing is saved.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="ytd-files">Files (.zip or .json)</Label>
              <input
                id="ytd-files"
                type="file"
                multiple
                accept=".zip,.json"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-card file:px-3 file:py-2 file:text-sm file:font-semibold"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ytd-from">Bring data from</Label>
              <Input id="ytd-from" type="date" value={fetchFrom} max={yesterday()} onChange={(e) => setFetchFrom(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy || !files.length}>
            <Upload />
            {busy ? "Checking with YouTube… (up to a minute)" : "Upload and connect"}
          </Button>
        </form>

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setFilter("")} className={filter === "" ? "rounded-full ring-2 ring-primary/40" : ""}>
                <Pill tone={DEAL_STATUS_TONES.expired}>All {result.rows.length}</Pill>
              </button>
              {chips.map(([key, n]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={filter === key ? "rounded-full ring-2 ring-primary/40" : ""}>
                  <Pill tone={RESULT[key].tone}>
                    {n} {RESULT[key].label.toLowerCase()}
                  </Pill>
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.file + r.result}>
                      <TableCell>
                        <p className="font-medium">{r.channel_name ?? r.youtube_title ?? r.file}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.channel_id ?? r.file}</p>
                      </TableCell>
                      <TableCell>
                        <Pill tone={RESULT[r.result].tone}>{RESULT[r.result].label}</Pill>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.message ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">After uploading, delete the files from your computer and WhatsApp: they unlock the channels&apos; revenue.</p>
          </div>
        )}

        <div className="space-y-3 rounded-xl border p-4">
          <p className="font-semibold">Daily sync</p>
          <p className="text-sm text-muted-foreground">
            Runs every morning by itself for the last 5 days. Closed months, and months that already have the CMS sheet&apos;s final
            figures, are never changed.
          </p>
          {sync?.running && (
            <Notice kind="info">
              Fetching {sync.done} of {sync.total} channels ({shortDate(sync.start)} – {shortDate(sync.end)})…
            </Notice>
          )}
          {sync && !sync.running && sync.finished_at && (
            <Notice kind={sync.failed ? "warning" : "success"}>
              Last run {formatDateTime(sync.finished_at)}: {sync.done - sync.failed} channels updated
              {sync.failed > 0 && `, ${sync.failed} with a problem (${sync.errors.slice(0, 2).join("; ")}${sync.errors.length > 2 ? "…" : ""})`}.
            </Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
            <Button type="button" variant="outline" disabled={sync?.running} onClick={() => startSync({})}>
              <RefreshCw />
              Sync now
            </Button>
            <div className="space-y-2">
              <Label htmlFor="ytd-h-from">History from</Label>
              <Input id="ytd-h-from" type="date" value={historyFrom} max={historyTo} onChange={(e) => setHistoryFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ytd-h-to">To</Label>
              <Input id="ytd-h-to" type="date" value={historyTo} max={yesterday()} onChange={(e) => setHistoryTo(e.target.value)} />
            </div>
            <Button type="button" variant="outline" disabled={sync?.running || !historyFrom || !historyTo} onClick={() => startSync({ start: historyFrom, end: historyTo })}>
              <CloudDownload />
              Fetch history
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
