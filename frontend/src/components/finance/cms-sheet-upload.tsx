"use client";

import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth, money } from "@/lib/finance";
import type { CmsPartner, SheetImport, SheetPreview } from "@/lib/types";

/**
 * Upload a CMS's monthly sheet exactly as the CMS sends it (Excel or CSV). The tool reads which
 * column is which, the founder checks it once, and that layout is remembered for the CMS.
 */
export function CmsSheetUpload({
  open,
  onClose,
  month,
  cmsList,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  month: string;
  cmsList: CmsPartner[];
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cms, setCms] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [rate, setRate] = useState("");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [result, setResult] = useState<SheetImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setMapping(null);
      setRate("");
      setPreview(null);
      setResult(null);
      setError(null);
      setShowUnknown(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [open]);

  function form(f: File, chosen: Record<string, string> | null, sheetRate: string) {
    const data = new FormData();
    data.append("cms_partner_id", cms);
    data.append("month", month);
    data.append("file", f);
    if (chosen) data.append("mapping", JSON.stringify(chosen));
    if (sheetRate.trim()) data.append("sheet_rate", sheetRate.trim());
    return data;
  }

  async function read(f: File, chosen: Record<string, string> | null, sheetRate: string) {
    setBusy(true);
    setError(null);
    try {
      const p = await api<SheetPreview>("/finance/cms-sheet/preview", { method: "POST", form: form(f, chosen, sheetRate) });
      setPreview(p);
      setMapping(p.mapping);
      if (!sheetRate.trim() && p.sheet_rate) setRate(String(Number(p.sheet_rate)));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(false);
    }
  }

  async function importIt() {
    if (!file || !mapping) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api<SheetImport>("/finance/cms-sheet/import", { method: "POST", form: form(file, mapping, rate) }));
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const cmsName = cmsList.find((c) => c.id === cms)?.name ?? "this CMS";
  const cur = preview?.currency ?? "USD";
  const base = preview?.base_currency ?? "INR";
  const usesLocal = Boolean(mapping?.net_local) && !mapping?.net;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Upload a CMS sheet"
      description={`The sheet for ${formatMonth(month)}, exactly as the CMS sends it — Excel or CSV. No need to change its columns.`}
      wide
    >
      {result ? (
        <div className="space-y-4">
          <Notice kind="success">
            {result.lines_imported} channel{result.lines_imported === 1 ? "" : "s"} booked as {cmsName}&apos;s revenue for {formatMonth(month)}
            {result.statement ? ", and its statement is saved for channel-by-channel matching." : "."}
          </Notice>
          {result.warnings.map((w) => (
            <Notice key={w} kind="warning">
              {w}
            </Notice>
          ))}
          {result.unknown.length > 0 && (
            <Notice kind="warning">
              {result.unknown.length} channel{result.unknown.length === 1 ? " is" : "s are"} not in the tool and were skipped. Add{" "}
              {result.unknown.length === 1 ? "it" : "them"} under{" "}
              <Link href="/channels" className="font-semibold underline">
                Channels
              </Link>{" "}
              and upload the sheet again — nothing is counted twice.
            </Notice>
          )}
          <p className="text-sm text-muted-foreground">
            The column layout is saved for {cmsName}; next month&apos;s sheet is read the same way.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sheet-cms">Which CMS sent it? *</Label>
              <NativeSelect
                id="sheet-cms"
                value={cms}
                onChange={(e) => {
                  setCms(e.target.value);
                  setPreview(null);
                  setMapping(null);
                  setFile(null);
                  setRate("");
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                <option value="">Choose the CMS…</option>
                {cmsList
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.has_sheet_mapping ? " (layout saved)" : ""}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label>File</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFile(f);
                  setRate("");
                  read(f, null, "");
                }}
              />
              <Button variant="outline" className="w-full justify-start" disabled={!cms || busy} onClick={() => fileRef.current?.click()}>
                <FileSpreadsheet />
                {file ? file.name : cms ? "Choose the sheet…" : "Choose the CMS first"}
              </Button>
            </div>
          </div>

          {busy && !preview && <p className="text-sm text-muted-foreground">Reading the sheet…</p>}
          {error && <Notice kind="error">{error}</Notice>}

          {preview && mapping && file && (
            <>
              <section className="space-y-3">
                <div>
                  <h4 className="font-semibold">
                    Which column is which
                    <InfoTip text="The tool guesses from the column names. Change any that are wrong — the choice is remembered for this CMS." />
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {preview.mapping_source === "saved"
                      ? `Using the layout saved for ${cmsName}.`
                      : preview.mapping_source === "guessed"
                        ? `Guessed from the column names — check once; it is remembered for ${cmsName}.`
                        : "Your choice — it will be remembered when you import."}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {preview.roles.map((r) => (
                    <div key={r.key} className="space-y-1">
                      <Label htmlFor={`role-${r.key}`} className="text-xs">
                        {r.label}
                        {r.required ? " *" : ""}
                        {r.hint && <InfoTip text={r.hint} />}
                      </Label>
                      <NativeSelect
                        id={`role-${r.key}`}
                        value={mapping[r.key] ?? ""}
                        disabled={busy}
                        onChange={(e) => {
                          const next = { ...mapping, [r.key]: e.target.value };
                          if (!e.target.value) delete next[r.key];
                          setMapping(next);
                          read(file, next, rate);
                        }}
                      >
                        <option value="">{r.required ? "Choose…" : "— not in this sheet —"}</option>
                        {preview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  ))}
                  {usesLocal && (
                    <div className="space-y-1">
                      <Label htmlFor="sheet-rate" className="text-xs">
                        Sheet&apos;s rate ({cur} → {base})
                        <InfoTip text="The rate the CMS used for its local-currency column, read from a header like INR@95.92. Only used to turn that column back into dollars; your own numbers use the company's monthly rate." />
                      </Label>
                      <Input
                        id="sheet-rate"
                        inputMode="decimal"
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        onBlur={() => read(file, mapping, rate)}
                      />
                    </div>
                  )}
                </div>
              </section>

              {preview.problems.map((p) => (
                <Notice key={p} kind="error">
                  {p}
                </Notice>
              ))}

              {preview.problems.length === 0 && (
                <>
                  <section className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <Stat label="Channels found" value={`${preview.matched} of ${preview.lines}`} />
                    <Stat label="Gross" value={money(preview.totals.gross, cur)} />
                    <Stat label="Tax withheld" value={money(preview.totals.tax, cur)} />
                    <Stat label="CMS pays you" value={money(preview.totals.net, cur)} />
                    <Stat label="CMS fee (from the sheet)" value={money(preview.totals.fee, cur)} />
                    <Stat label={`In the sheet (${base})`} value={money(preview.totals.net_local, base)} />
                    <Stat label={`Gross at your rate`} value={preview.company_rate ? money(preview.gross_base, base) : "Add the month's rate"} />
                    <Stat label="Rates" value={`Sheet ${preview.sheet_rate ? Number(preview.sheet_rate) : "—"} · yours ${preview.company_rate ? Number(preview.company_rate) : "—"}`} />
                  </section>

                  <div className="max-h-64 overflow-auto rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Channel</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Tax</TableHead>
                          <TableHead className="text-right">CMS fee</TableHead>
                          <TableHead className="text-right">CMS pays</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.sample.map((l) => (
                          <TableRow key={l.line}>
                            <TableCell>
                              <span className="font-medium">{l.channel_name ?? l.external_id}</span>
                              <span className="block font-mono text-xs text-muted-foreground">
                                {l.external_id}
                                {!l.channel_id && <span className="ml-1 font-sans font-semibold text-amber-600">· not in the tool</span>}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">{money(l.gross, cur)}</TableCell>
                            <TableCell className="text-right">{money(l.tax, cur)}</TableCell>
                            <TableCell className="text-right">{money(l.fee, cur)}</TableCell>
                            <TableCell className="text-right font-semibold">{money(l.net, cur)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    First {preview.sample.length} of {preview.lines} channels.
                    {preview.skipped > 0 && ` ${preview.skipped} blank or total row${preview.skipped === 1 ? "" : "s"} ignored.`}
                  </p>

                  {preview.replaces > 0 && (
                    <Notice kind="warning">
                      {preview.replaces} of these channels already have revenue for {formatMonth(month)}. This sheet replaces it — nothing is counted twice.
                    </Notice>
                  )}
                  {preview.unknown.length > 0 && (
                    <Notice kind="warning">
                      {preview.unknown.length} channel{preview.unknown.length === 1 ? " is" : "s are"} not in the tool and will be skipped.{" "}
                      <button type="button" className="font-semibold underline" onClick={() => setShowUnknown((v) => !v)}>
                        {showUnknown ? "Hide" : "See which"}
                      </button>
                      {showUnknown && (
                        <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs">
                          {preview.unknown.map((u) => (
                            <li key={u.line}>
                              Line {u.line}: {u.channel_name ?? "—"} <span className="font-mono">{u.external_id}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Notice>
                  )}
                  {preview.errors.length > 0 && (
                    <Notice kind="error">
                      {preview.errors.length} line{preview.errors.length === 1 ? "" : "s"} cannot be read:{" "}
                      {preview.errors
                        .slice(0, 3)
                        .map((e) => `line ${e.line} — ${e.message}`)
                        .join("; ")}
                      {preview.errors.length > 3 && "…"}
                    </Notice>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      <DialogFooter>
        {result ? (
          <>
            {result.statement && (
              <Button variant="outline" asChild>
                <Link href={`/finance/${cms}?month=${month}&tab=statement`}>Open the statement</Link>
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!preview || preview.problems.length > 0 || preview.matched === 0 || busy} onClick={importIt}>
              {busy && preview ? "Working…" : preview ? `Import ${preview.matched} channel${preview.matched === 1 ? "" : "s"}` : "Import"}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}
