"use client";

import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, EmptyRow, SearchInput, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/deals";
import type { Episode, EpisodeScope, Page } from "@/lib/types";

type Form = {
  season: string;
  episode_number: string;
  title: string;
  description: string;
  air_date: string;
  duration_minutes: string;
  language: string;
};

const EMPTY: Form = { season: "", episode_number: "", title: "", description: "", air_date: "", duration_minutes: "", language: "" };

type ImportResult = { created: number; updated: number; errors: { line: number; message: string }[] };

function fromEpisode(e: Episode): Form {
  return {
    season: e.season ? String(e.season) : "",
    episode_number: String(e.episode_number),
    title: e.title,
    description: e.description ?? "",
    air_date: e.air_date ?? "",
    duration_minutes: e.duration_minutes ? String(e.duration_minutes) : "",
    language: e.language ?? "",
  };
}

/** Episode metadata for a deal (PDF slide 4, step 03): title, synopsis, air date, duration. */
export function DealEpisodes({ dealId, scope, onChange }: { dealId: string; scope: EpisodeScope; onChange: () => void }) {
  const [data, setData] = useState<Page<Episode> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Episode | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [fieldError, setFieldError] = useState<{ field: keyof Form | "form"; message: string } | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q.trim()) params.set("q", q.trim());
    api<Page<Episode>>(`/deals/${dealId}/episodes?${params}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [dealId, page, pageSize, q]);
  useEffect(load, [load]);

  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  function open(target: Episode | "new") {
    setEditing(target);
    setForm(target === "new" ? EMPTY : fromEpisode(target));
    setFieldError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);
    const payload = {
      season: form.season ? Number(form.season) : null,
      episode_number: Number(form.episode_number),
      title: form.title,
      description: form.description || null,
      air_date: form.air_date || null,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      language: form.language || null,
    };
    try {
      if (editing === "new") await api(`/deals/${dealId}/episodes`, { method: "POST", json: payload });
      else if (editing) await api(`/episodes/${editing.id}`, { method: "PUT", json: payload });
      setEditing(null);
      load();
      onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      const lower = message.toLowerCase();
      const field: keyof Form | "form" = lower.includes("title")
        ? "title"
        : lower.includes("season")
          ? "season"
          : lower.includes("episode")
            ? "episode_number"
            : "form";
      setFieldError({ field, message });
    }
  }

  async function remove(e: Episode) {
    if (!window.confirm(`Delete the details of episode ${e.episode_number}?`)) return;
    try {
      await api(`/episodes/${e.id}`, { method: "DELETE" });
      load();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function upload(file: File) {
    setError(null);
    setImported(null);
    const body = new FormData();
    body.append("file", file);
    try {
      setImported(await api<ImportResult>(`/deals/${dealId}/episodes/import`, { method: "POST", form: body }));
      load();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const err = (field: keyof Form) =>
    fieldError?.field === field ? <p data-field-error className="text-sm font-medium text-red-600 dark:text-red-400">{fieldError.message}</p> : null;
  const label = (e: Episode) => (e.season ? `S${e.season} E${e.episode_number}` : `Ep ${e.episode_number}`);

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
        <div>
          <h3 className="text-lg font-semibold">
            Episodes <InfoTip text={HELP.episodes} />
          </h3>
          <p className="text-sm text-muted-foreground">
            Title and details of each licensed episode (PDF slide 4, step 03). Only episodes inside the licence can be added.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <a href="/api/episodes/template">
              <Download />
              CSV template
            </a>
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => open("new")}>
            <Plus />
            Add episode
          </Button>
        </div>
      </div>

      <div className="space-y-3 px-6">
        {error && <Notice kind="error">{error}</Notice>}
        {imported && (
          <Notice kind={imported.errors.length ? "warning" : "success"}>
            Imported: {imported.created} new, {imported.updated} updated
            {imported.errors.length > 0 && `, ${imported.errors.length} row(s) skipped`}.
            {imported.errors.slice(0, 5).map((e) => (
              <span key={e.line} className="block">
                Line {e.line}: {e.message}
              </span>
            ))}
          </Notice>
        )}
        <Dialog
          open={editing !== null}
          onClose={() => setEditing(null)}
          title={editing === "new" ? "Add episode" : "Edit episode"}
          description="Only episodes inside the licence can be added."
          wide
        >
        {editing && (
          <form onSubmit={save} className="grid gap-4 md:grid-cols-6">
            {scope === "seasons" && (
              <div className="space-y-1">
                <Label htmlFor="ep-season">Season *</Label>
                <Input id="ep-season" type="number" min="1" required value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} />
                {err("season")}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ep-number">Episode *</Label>
              <Input
                id="ep-number"
                type="number"
                min="1"
                required
                value={form.episode_number}
                onChange={(e) => setForm({ ...form, episode_number: e.target.value })}
              />
              {err("episode_number")}
            </div>
            <div className={scope === "seasons" ? "space-y-1 md:col-span-4" : "space-y-1 md:col-span-5"}>
              <Label htmlFor="ep-title">Title *</Label>
              <Input id="ep-title" required maxLength={300} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              {err("title")}
            </div>
            <div className="space-y-1 md:col-span-6">
              <Label htmlFor="ep-desc">Details / synopsis</Label>
              <textarea
                id="ep-desc"
                rows={2}
                className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Guests, segments, notable scenes…"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="ep-air">Original air date</Label>
              <Input id="ep-air" type="date" value={form.air_date} onChange={(e) => setForm({ ...form, air_date: e.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="ep-dur">Duration (minutes)</Label>
              <Input
                id="ep-dur"
                type="number"
                min="1"
                value={form.duration_minutes}
                onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="ep-lang">Language</Label>
              <Input id="ep-lang" maxLength={60} placeholder="Hindi" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            </div>
            {fieldError?.field === "form" && (
              <div className="md:col-span-6">
                <Notice kind="error">{fieldError.message}</Notice>
              </div>
            )}
            <div className="md:col-span-6">
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit">{editing === "new" ? "Add episode" : "Save"}</Button>
              </DialogFooter>
            </div>
          </form>
        )}
        </Dialog>
        <SearchInput value={search} onChange={setSearch} placeholder="Search title, details or episode number…" />
      </div>

      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Episode</TableHead>
            <TableHead>Title &amp; details</TableHead>
            <TableHead>Aired</TableHead>
            <TableHead>Length</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-mono text-xs font-semibold">{label(e)}</TableCell>
              <TableCell>
                <p className="font-semibold">{e.title}</p>
                {e.description && <p className="line-clamp-2 text-sm text-muted-foreground">{e.description}</p>}
              </TableCell>
              <TableCell className="whitespace-nowrap">{e.air_date ? formatDate(e.air_date) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap">
                {e.duration_minutes ? `${e.duration_minutes} min` : "—"}
                {e.language && <span className="block text-xs text-muted-foreground">{e.language}</span>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <Button variant="ghost" size="icon" aria-label={`Edit ${label(e)}`} onClick={() => open(e)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${label(e)}`} onClick={() => remove(e)}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {data && data.total === 0 && (
            <EmptyRow colSpan={5}>{q ? "No episode matches." : "No episode details yet — add one or import a CSV."}</EmptyRow>
          )}
        </TableBody>
      </Table>
      {data && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizes={PAGE_SIZES}
          noun="episodes"
        />
      )}
    </section>
  );
}
