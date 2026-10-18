"use client";

import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Field } from "@/components/deal/form-bits";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { DealDocument, DocumentKind } from "@/lib/types";

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  contract: "Signed contract",
  annexure: "Annexure / amendment",
  rights_evidence: "Rights evidence",
  invoice: "Invoice",
  other: "Other",
};

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.eml";
const MAX_BYTES = 15 * 1024 * 1024;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Contract and supporting files for a deal (PDF slide 4, step 03: "Drive library + contract"). */
export function DealDocuments({ dealId, onChange }: { dealId: string; onChange: () => void }) {
  const [docs, setDocs] = useState<DealDocument[]>([]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>("contract");
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<DealDocument[]>(`/deals/${dealId}/documents`).then(setDocs).catch((err: Error) => setError(err.message));
  }, [dealId]);
  useEffect(load, [load]);

  const tooBig = picked.filter((f) => f.size > MAX_BYTES);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!picked.length || tooBig.length) return;
    setUploadError(null);
    setBusy(true);
    const body = new FormData();
    picked.forEach((f) => body.append("files", f));
    body.append("kind", kind);
    try {
      await api(`/deals/${dealId}/documents`, { method: "POST", form: body });
      setOpen(false);
      setPicked([]);
      load();
      onChange();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: DealDocument) {
    if (!window.confirm(`Delete ${d.file_name}?`)) return;
    try {
      await api(`/documents/${d.id}`, { method: "DELETE" });
      load();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
        <div>
          <h3 className="text-lg font-semibold">Documents</h3>
          <p className="text-sm text-muted-foreground">Signed contract, annexures and rights evidence for this deal.</p>
        </div>
        <Button
          onClick={() => {
            setOpen(true);
            setPicked([]);
            setUploadError(null);
          }}
        >
          <Upload />
          Upload files
        </Button>
      </div>
      {error && (
        <div className="px-6 pb-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <a href={`/api/documents/${d.id}/download`} className="flex items-center gap-2 font-medium hover:text-primary">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={d.file_name}>
                    {d.file_name}
                  </span>
                </a>
              </TableCell>
              <TableCell>
                <Pill tone="border-border bg-muted text-foreground">{DOCUMENT_KIND_LABELS[d.kind]}</Pill>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{size(d.size_bytes)}</TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {d.uploaded_by ?? "—"}
                <span className="block text-xs">{formatDateTime(d.created_at)}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <Button variant="ghost" size="icon" asChild>
                  <a href={`/api/documents/${d.id}/download`} aria-label={`Download ${d.file_name}`}>
                    <Download />
                  </a>
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${d.file_name}`} onClick={() => remove(d)}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {docs.length === 0 && <EmptyRow colSpan={5}>No files yet — upload the signed contract.</EmptyRow>}
        </TableBody>
      </Table>

      <Dialog open={open} onClose={() => setOpen(false)} title="Upload files" description="PDF, Word, Excel, images or saved emails — up to 15 MB each.">
        <form onSubmit={upload} className="space-y-4">
          <Field id="doc-kind" label="What are these files?">
            <NativeSelect id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {Object.entries(DOCUMENT_KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="doc-files" label="Files *" error={tooBig.length ? `${tooBig.map((f) => f.name).join(", ")} ${tooBig.length > 1 ? "are" : "is"} larger than 15 MB.` : null}>
            <input
              ref={fileRef}
              id="doc-files"
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <Upload className="h-6 w-6" />
              {picked.length ? "Choose different files" : "Click to choose files (you can pick several)"}
            </button>
          </Field>
          {picked.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
              {picked.map((f) => (
                <li key={f.name} className="flex justify-between gap-3">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-muted-foreground">{size(f.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {uploadError && <Notice kind="error">{uploadError}</Notice>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !picked.length || tooBig.length > 0}>
              {busy ? "Uploading…" : `Upload ${picked.length || ""} file${picked.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </section>
  );
}
