"use client";

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, MinusCircle, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";

import { InlineLoader } from "@/components/loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Line = {
  line: number;
  external_id: string;
  name: string;
  platform: string;
  cms: string | null;
  manager: string | null;
  partner?: string | null;
  status: string;
  result: "new" | "exists" | "duplicate" | "error";
  notes: string[];
};
type ImportOut = { added: number; exists: number; duplicate: number; errors: number; with_notes: number; missing_columns: string[]; lines: Line[] };

const RESULT = {
  new: { icon: CheckCircle2, className: "text-emerald-600", label: "Will be added" },
  exists: { icon: MinusCircle, className: "text-muted-foreground", label: "Already in the tool" },
  duplicate: { icon: MinusCircle, className: "text-muted-foreground", label: "Repeated in the file" },
  error: { icon: XCircle, className: "text-red-600", label: "Skipped" },
} as const;

const COLUMNS: [string, string, boolean][] = [
  ["Channel ID", "UC… ID, the channel link, or the Facebook page ID", true],
  ["Channel name", "As you want it shown in the tool", true],
  ["Platform", "YouTube / Facebook — guessed from the ID if empty", false],
  ["CMS", "Must match a CMS partner's name", false],
  ["Manager", "Name or email, as in People", false],
  ["Status", "Active / Inactive — Active if empty", false],
  ["Partner", "Deal partner who owns it (e.g. Vanshika) — empty for Taggify's own", false],
];

export function ChannelImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (added: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "notes" | "skipped">("all");

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    setShow("all");
    if (input.current) input.current.value = "";
  }

  async function check(f: File) {
    setFile(f);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      setPreview(await api<ImportOut>("/channels/import/preview", { method: "POST", form }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const out = await api<ImportOut>("/channels/import", { method: "POST", form });
      onImported(out.added);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  const lines = (preview?.lines ?? []).filter((l) =>
    show === "notes" ? l.result === "new" && l.notes.length > 0 : show === "skipped" ? l.result !== "new" : true,
  );
  const skipped = preview ? preview.exists + preview.duplicate + preview.errors : 0;

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      wide
      title="Import channels"
      description="Add many channels at once from an Excel or CSV file. Only the channel ID and name are required — everything else can be filled in later."
    >
      <div className="space-y-5">
        {!preview && (
          <>
            <div className="rounded-xl border">
              <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
                <p className="text-sm font-semibold">What the file can have</p>
                <a
                  href="/api/channels/import/template"
                  download
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <Download className="h-4 w-4" /> Template
                </a>
              </div>
              <ul className="divide-y text-sm">
                {COLUMNS.map(([name, hint, required]) => (
                  <li key={name} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2">
                    <span className="w-28 font-medium">{name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        required ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {required ? "Required" : "Optional"}
                    </span>
                    <span className="text-muted-foreground">{hint}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void check(f);
              }}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              {busy ? (
                <InlineLoader />
              ) : (
                <>
                  <Upload className="h-7 w-7 text-primary" />
                  <span className="font-semibold">Choose or drop the file</span>
                  <span className="text-xs text-muted-foreground">
                    .xlsx or .csv · column names in any order · nothing is saved until you confirm
                  </span>
                </>
              )}
            </button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.xlsm,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void check(f);
              }}
            />
          </>
        )}

        {preview && preview.missing_columns.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">
                {file?.name} has no {preview.missing_columns.map((c) => `“${c}”`).join(" or ")} column
              </p>
              <p>Name the columns “Channel ID” and “Channel name” (or use the template) and choose the file again.</p>
            </div>
          </div>
        )}

        {preview && preview.missing_columns.length === 0 && (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" /> {file?.name}
              <button type="button" className="ml-auto font-medium text-primary hover:underline" onClick={reset}>
                Choose another file
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [
                  "all",
                  preview.added,
                  "will be added",
                  "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
                ],
                [
                  "notes",
                  preview.with_notes,
                  "added with a note",
                  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
                ],
                ["skipped", skipped, "skipped (missing ID or name, or already there)", "border-border bg-muted/50 text-muted-foreground"],
              ].map(([key, n, label, tone]) => (
                <button
                  key={key as string}
                  type="button"
                  onClick={() => setShow(key as typeof show)}
                  className={cn("rounded-xl border p-3 text-left transition-shadow", tone as string, show === key && "ring-2 ring-primary/40")}
                >
                  <p className="text-2xl font-bold tabular-nums">{n as number}</p>
                  <p className="text-xs font-medium">{label as string}</p>
                </button>
              ))}
            </div>
            <div className="max-h-[22rem] overflow-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Line</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>CMS · Manager</TableHead>
                    <TableHead>What happens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const r = RESULT[l.result];
                    return (
                      <TableRow key={l.line}>
                        <TableCell className="tabular-nums text-muted-foreground">{l.line}</TableCell>
                        <TableCell>
                          <p className="font-medium">{l.name || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.external_id || "no ID"} {l.platform && `· ${l.platform === "youtube" ? "YouTube" : "Facebook"}`}
                            {l.status === "inactive" && " · inactive"}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">
                          <p>{l.cms ?? <span className="text-muted-foreground">No CMS</span>}</p>
                          <p className="text-xs text-muted-foreground">{l.manager ?? "No manager"}</p>
                          {l.partner && <p className="text-xs font-medium text-violet-700 dark:text-violet-400">Partner: {l.partner}</p>}
                        </TableCell>
                        <TableCell className="text-sm">
                          <p className={cn("flex items-center gap-1.5 font-medium", r.className)}>
                            <r.icon className="h-4 w-4" /> {r.label}
                          </p>
                          {l.notes.map((n) => (
                            <p key={n} className="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                              {l.result === "new" && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                              {n}
                            </p>
                          ))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing here.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {preview.with_notes > 0 && (
              <p className="text-xs text-muted-foreground">
                Lines with a note are still added — set the missing CMS or manager on the channel later.
              </p>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!preview || preview.added === 0 || busy} onClick={save}>
            {busy && preview ? "Adding…" : preview ? `Add ${preview.added} channel${preview.added === 1 ? "" : "s"}` : "Add channels"}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
