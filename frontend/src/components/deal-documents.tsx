"use client";

import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
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

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Contract and supporting files for a deal (PDF slide 4, step 03: "Drive library + contract"). */
export function DealDocuments({ dealId, onChange }: { dealId: string; onChange: () => void }) {
  const [docs, setDocs] = useState<DealDocument[]>([]);
  const [kind, setKind] = useState<DocumentKind>("contract");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<DealDocument[]>(`/deals/${dealId}/documents`).then(setDocs).catch((err: Error) => setError(err.message));
  }, [dealId]);
  useEffect(load, [load]);

  async function upload(files: FileList) {
    setError(null);
    setBusy(true);
    const body = new FormData();
    Array.from(files).forEach((f) => body.append("files", f));
    body.append("kind", kind);
    try {
      await api(`/deals/${dealId}/documents`, { method: "POST", form: body });
      load();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">Documents</h3>
      <p className="text-sm text-muted-foreground">Signed contract, annexures, rights evidence. Up to 15 MB per file.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <NativeSelect aria-label="Document type" className="w-52" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
          {Object.entries(DOCUMENT_KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files?.length && upload(e.target.files)}
        />
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload />
          {busy ? "Uploading…" : "Upload files"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">You can pick several files at once (PDF, Word, Excel, images, email).</p>
      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={d.file_name}>
                {d.file_name}
              </p>
              <p className="text-xs text-muted-foreground">
                {DOCUMENT_KIND_LABELS[d.kind]} · {size(d.size_bytes)} · {d.uploaded_by ?? "—"} · {formatDateTime(d.created_at)}
              </p>
            </div>
            <Button variant="ghost" size="icon" asChild>
              <a href={`/api/documents/${d.id}/download`} aria-label={`Download ${d.file_name}`}>
                <Download />
              </a>
            </Button>
            <Button variant="ghost" size="icon" aria-label={`Delete ${d.file_name}`} onClick={() => remove(d)}>
              <Trash2 />
            </Button>
          </li>
        ))}
        {docs.length === 0 && <li className="text-sm text-muted-foreground">No files yet.</li>}
      </ul>
    </section>
  );
}
