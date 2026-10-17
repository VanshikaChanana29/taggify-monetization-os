"use client";

import { ArrowLeft, Download, FileUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyRow, FilterBar, SortableHead, TablePagination } from "@/components/data-table";
import { MonthPicker } from "@/components/month-picker";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate } from "@/lib/deals";
import { money, shiftMonth, thisMonth } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import type { CmsPartner, Page, RevenueFact, RevenueImport } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";

export default function RevenuePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<RevenueImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<Page<RevenueImport> | null>(null);
  const [month, setMonth] = useState(shiftMonth(thisMonth(), -1));
  const [cmsList, setCmsList] = useState<CmsPartner[]>([]);
  const [cms, setCms] = useState("");
  const [sort, setSort] = useState<SortState<"day" | "gross">>({ key: "day", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
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

  return (
    <div className="space-y-8">
      <Link href="/finance" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        CMS & Finance
      </Link>
      <PageHeader
        title="Revenue"
        description="Import daily gross revenue per channel (CSV) until the YouTube / Meta connections arrive in Part 6."
      />

      <section className="rounded-2xl border border-dashed bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Upload a revenue CSV</h3>
            <p className="text-sm text-muted-foreground">
              Columns: <span className="font-mono">date, channel_id, platform, gross_revenue, currency, views, state</span>. Importing the same
              channel and date again updates it.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <a href="/api/revenue/template" download>
                <Download />
                Template
              </a>
            </Button>
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              <FileUp />
              {uploading ? "Importing…" : "Choose CSV"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </div>
        </div>
        {result && (
          <div className="mt-5 space-y-3">
            <Notice kind={result.rows_failed ? "error" : "success"}>
              {result.file_name}: {result.rows_created} added, {result.rows_updated} updated, {result.rows_failed} failed
              {result.rows_total ? ` (of ${result.rows_total} rows)` : ""}.
            </Notice>
            {result.errors.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Problem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono">{e.line}</TableCell>
                        <TableCell className="text-red-600">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </section>

      {error && <Notice kind="error">{error}</Notice>}

      <FilterBar active={Boolean(cms)} onClear={() => setCms("")}>
        <MonthPicker month={month} onChange={(m) => { setMonth(m); setPage(1); }} />
        <NativeSelect aria-label="Filter by CMS" className="w-44" value={cms} onChange={(e) => { setCms(e.target.value); setPage(1); }}>
          <option value="">All CMS</option>
          {cmsList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date" sortKey="day" sort={sort} onSort={() => setSort((s) => ({ key: "day", dir: s.key === "day" && s.dir === "desc" ? "asc" : "desc" }))} />
              <TableHead>Channel</TableHead>
              <TableHead>CMS</TableHead>
              <SortableHead label="Gross" sortKey="gross" sort={sort} onSort={() => setSort((s) => ({ key: "gross", dir: s.key === "gross" && s.dir === "desc" ? "asc" : "desc" }))} />
              <TableHead>Views</TableHead>
              <TableHead>State</TableHead>
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
                  <Pill tone={f.state === "final" ? DEAL_STATUS_TONES.active : DEAL_STATUS_TONES.draft}>
                    {f.state === "final" ? "Final" : "Provisional"}
                  </Pill>
                </TableCell>
              </TableRow>
            ))}
            {facts && facts.total === 0 && <EmptyRow colSpan={6}>No revenue for this month yet.</EmptyRow>}
          </TableBody>
        </Table>
        {facts && (
          <TablePagination page={page} pageSize={pageSize} total={facts.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizes={[25, 50, 100]} noun="rows" />
        )}
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Recent imports</h3>
        <ul className="mt-4 space-y-2 text-sm">
          {imports?.items.map((i) => (
            <li key={i.id} className="flex flex-wrap justify-between gap-2 border-l-2 border-primary/40 pl-4">
              <span className="font-medium">{i.file_name}</span>
              <span className="text-muted-foreground">
                {i.rows_created} added · {i.rows_updated} updated · {i.rows_failed} failed · {i.uploaded_by ?? "—"} · {formatDateTime(i.created_at)}
              </span>
            </li>
          ))}
          {imports && imports.items.length === 0 && <li className="text-muted-foreground">No imports yet.</li>}
        </ul>
      </section>
    </div>
  );
}
