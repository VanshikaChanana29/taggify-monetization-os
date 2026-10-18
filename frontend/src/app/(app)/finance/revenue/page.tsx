"use client";

import { Download, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { useFinanceMonth } from "@/components/finance/finance-shell";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate } from "@/lib/deals";
import { formatMonth, money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import type { CmsPartner, Page, RevenueFact, RevenueImport } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";

const COLUMNS: [string, string][] = [
  ["date", "Day of the earnings, e.g. 2026-09-15"],
  ["channel_id", "The channel's YouTube ID (UC…) or Facebook page ID — exactly as saved under Channels"],
  ["platform", "youtube or facebook (optional)"],
  ["gross_revenue", "Earnings before any deduction, e.g. 6000"],
  ["currency", "USD, AED, INR…"],
  ["views", "Optional"],
  ["state", "provisional or final (optional)"],
];

function ImportResult({ result }: { result: RevenueImport }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{result.rows_created}</p>
          <p className="text-muted-foreground">added</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-3 dark:bg-sky-500/10">
          <p className="text-2xl font-bold text-sky-700 dark:text-sky-400">{result.rows_updated}</p>
          <p className="text-muted-foreground">updated</p>
        </div>
        <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{result.rows_failed}</p>
          <p className="text-muted-foreground">failed</p>
        </div>
      </div>
      {result.errors.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Line</TableHead>
                <TableHead>Why it was skipped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.errors.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono">{e.line}</TableCell>
                  <TableCell className="text-red-600 dark:text-red-400">{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {result.rows_failed > 0 && (
        <p className="text-xs text-muted-foreground">The other lines were saved. Fix the skipped lines and upload the file again — saved lines will just be updated, not doubled.</p>
      )}
    </div>
  );
}

function RevenueTab() {
  const [month] = useFinanceMonth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<RevenueImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<Page<RevenueImport> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cmsList, setCmsList] = useState<CmsPartner[]>([]);
  const [cms, setCms] = useState("");
  const [sort, setSort] = useState<SortState<"day" | "gross">>({ key: "day", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [facts, setFacts] = useState<Page<RevenueFact> | null>(null);

  const loadImports = useCallback(() => {
    api<Page<RevenueImport>>("/revenue/imports?page_size=10").then(setImports).catch(() => {});
  }, []);
  const loadFacts = useCallback(() => {
    const params = new URLSearchParams({ month, page: String(page), page_size: String(pageSize), sort: sort.key, direction: sort.dir });
    if (cms) params.set("cms_partner_id", cms);
    api<Page<RevenueFact>>(`/revenue/facts?${params}`).then(setFacts).catch((err: Error) => setError(err.message));
  }, [month, cms, sort, page, pageSize]);

  useEffect(() => {
    loadImports();
    api<CmsPartner[]>("/cms-partners").then(setCmsList).catch(() => {});
  }, [loadImports]);
  useEffect(loadFacts, [loadFacts]);
  useEffect(() => setPage(1), [month]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      setResult(await api<RevenueImport>("/revenue/import", { method: "POST", form }));
      loadImports();
      loadFacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const totals = new Map<string, number>();
  facts?.items.forEach((f) => totals.set(f.currency, (totals.get(f.currency) ?? 0) + Number(f.gross_amount)));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold">
            Revenue for {formatMonth(month)}
            <InfoTip text="Each channel's daily earnings. Until YouTube / Meta are connected (Part 6), they come from a CSV file you upload here." />
          </h3>
          <p className="text-sm text-muted-foreground">One line per channel per day. Uploading the same channel and day again updates it — nothing is counted twice.</p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            setResult(null);
            setError(null);
            setOpen(true);
          }}
        >
          <Upload />
          Import revenue file
        </Button>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div>
            <h3 className="text-lg font-semibold">What is saved</h3>
            <p className="text-sm text-muted-foreground">
              {facts ? `${facts.total} line${facts.total === 1 ? "" : "s"}` : "…"}
              {totals.size > 0 && facts && facts.total <= pageSize && ` · total ${[...totals].map(([c, v]) => money(v, c)).join(" + ")}`}
            </p>
          </div>
          <NativeSelect aria-label="Filter by CMS" className="w-48" value={cms} onChange={(e) => { setCms(e.target.value); setPage(1); }}>
            <option value="">All CMS partners</option>
            {cmsList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date" sortKey="day" sort={sort} onSort={() => setSort((s) => ({ key: "day", dir: s.key === "day" && s.dir === "desc" ? "asc" : "desc" }))} />
              <TableHead>Channel</TableHead>
              <TableHead>CMS</TableHead>
              <SortableHead label="Gross" sortKey="gross" sort={sort} onSort={() => setSort((s) => ({ key: "gross", dir: s.key === "gross" && s.dir === "desc" ? "asc" : "desc" }))} />
              <TableHead>Views</TableHead>
              <TableHead>
                State
                <InfoTip text="Provisional = the platform's early estimate, may change. Final = the confirmed number." />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facts?.items.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="whitespace-nowrap">{formatDate(f.day)}</TableCell>
                <TableCell>
                  <Link href={`/channels/${f.channel_id}`} className="font-medium hover:text-primary">
                    {f.channel_name}
                  </Link>
                </TableCell>
                <TableCell>{f.cms_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-semibold">{money(f.gross_amount, f.currency)}</TableCell>
                <TableCell>{f.views?.toLocaleString("en-IN") ?? "—"}</TableCell>
                <TableCell>
                  <Pill tone={f.state === "final" ? DEAL_STATUS_TONES.active : DEAL_STATUS_TONES.draft}>{f.state === "final" ? "Final" : "Provisional"}</Pill>
                </TableCell>
              </TableRow>
            ))}
            {facts && facts.total === 0 && <EmptyRow colSpan={6}>No revenue for {formatMonth(month)} yet — use “Import revenue file”.</EmptyRow>}
          </TableBody>
        </Table>
        {facts && (
          <TablePagination page={page} pageSize={pageSize} total={facts.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizes={PAGE_SIZES} noun="lines" />
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-6 pb-4">
          <h3 className="text-lg font-semibold">Upload history</h3>
          <p className="text-sm text-muted-foreground">Every file uploaded, by whom, and what happened to its lines.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Added</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports?.items.map((i) => (
              <Fragment key={i.id}>
                <TableRow>
                  <TableCell className="font-medium">{i.file_name}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {i.uploaded_by ?? "—"}
                    <span className="block text-xs">{formatDateTime(i.created_at)}</span>
                  </TableCell>
                  <TableCell className="text-right">{i.rows_created}</TableCell>
                  <TableCell className="text-right">{i.rows_updated}</TableCell>
                  <TableCell className={i.rows_failed ? "text-right font-semibold text-red-600" : "text-right"}>{i.rows_failed}</TableCell>
                  <TableCell className="text-right">
                    {i.errors.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === i.id ? null : i.id)}>
                        {expanded === i.id ? "Hide problems" : "See problems"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {expanded === i.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="bg-muted/30">
                      <ul className="space-y-1 text-sm">
                        {i.errors.map((e, n) => (
                          <li key={n}>
                            <span className="font-mono text-muted-foreground">Line {e.line}:</span> <span className="text-red-600 dark:text-red-400">{e.message}</span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {imports && imports.items.length === 0 && <EmptyRow colSpan={6}>No files uploaded yet.</EmptyRow>}
          </TableBody>
        </Table>
      </section>

      <Dialog open={open} onClose={() => setOpen(false)} title="Import revenue file" description="Three steps. The file can hold any month — each line carries its own date." wide>
        <ol className="space-y-5">
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">1</span>
            <div className="flex-1 space-y-2">
              <p className="font-semibold">Download the template</p>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/revenue/template" download>
                  <Download />
                  revenue-template.csv
                </a>
              </Button>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">2</span>
            <div className="flex-1">
              <p className="font-semibold">Fill one line per channel per day (Excel is fine — save as CSV)</p>
              <div className="mt-2 overflow-hidden rounded-xl border text-sm">
                <Table>
                  <TableBody>
                    {COLUMNS.map(([col, what]) => (
                      <TableRow key={col}>
                        <TableCell className="w-40 font-mono text-xs font-semibold">{col}</TableCell>
                        <TableCell className="text-muted-foreground">{what}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">3</span>
            <div className="flex-1 space-y-3">
              <p className="font-semibold">Upload it</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
              >
                <FileUp className="h-6 w-6" />
                {uploading ? "Importing…" : result ? "Upload another file" : "Click to choose the CSV file"}
              </button>
              {error && <Notice kind="error">{error}</Notice>}
              {result && <ImportResult result={result} />}
            </div>
          </li>
        </ol>
        <DialogFooter>
          <Button variant={result ? "default" : "outline"} onClick={() => setOpen(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

export default function RevenuePage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <RevenueTab />
    </Suspense>
  );
}
