"use client";

import { Download, FileText, FileUp, Pencil, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { Field, INVALID, fieldFor } from "@/components/deal/form-bits";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES } from "@/lib/deals";
import { formatMonth, money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import { HELP } from "@/lib/help";
import type { CmsMonth, ReconLine, ReconStatus, Statement, StatementImport } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<ReconStatus, { label: string; tone: string; help: string }> = {
  match: { label: "Matches", tone: DEAL_STATUS_TONES.active, help: "Their gross and net for this channel are the same as ours." },
  differs: {
    label: "Differs",
    tone: DEAL_STATUS_TONES.draft,
    help: "Their numbers for this channel are not ours. Ask the CMS why — a chargeback, tax or late revision goes under Adjustments.",
  },
  missing_in_statement: {
    label: "Missing in their statement",
    tone: DEAL_STATUS_TONES.terminated,
    help: "We have revenue for this channel but the CMS did not list it. They may be holding its payment — ask them.",
  },
  not_in_our_data: {
    label: "Not in our revenue",
    tone: DEAL_STATUS_TONES.upcoming,
    help: "The CMS paid for this channel but no revenue was imported for it this month. Check the revenue file.",
  },
  unknown_channel: {
    label: "Unknown channel",
    tone: DEAL_STATUS_TONES.terminated,
    help: "The CMS listed a channel ID that is not under Channels. Add it, or ask the CMS — it may not be yours.",
  },
};

const COLUMNS: [string, string][] = [
  ["channel_id", "The channel's YouTube ID (UC…) or Facebook page ID, as the CMS lists it"],
  ["channel_name", "Optional — for your reference"],
  ["gross", "Gross revenue the CMS shows for the channel"],
  ["fee", "The CMS's commission on that channel"],
  ["net", "Optional — checked: must be gross − fee"],
];

export function StatementTab({
  cmsId,
  month,
  summary,
  statement,
  reconciliation,
  onSaved,
  part,
}: {
  cmsId: string;
  month: string;
  summary: CmsMonth;
  statement: Statement | null;
  reconciliation: ReconLine[];
  onSaved: (message: string) => void;
  /** Show only the statement (upload, totals) or only the channel-by-channel reconciliation. */
  part?: "statement" | "reconciliation";
}) {
  const cur = summary.currency ?? "USD";
  const name = summary.cms_name;
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"upload" | "manual" | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StatementImport | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [manual, setManual] = useState({ gross: "", fee: "", reference: "" });
  const [errors, setErrors] = useState<Partial<Record<"gross" | "fee" | "form", string>>>({});
  const net = manual.gross && manual.fee ? (Number(manual.gross) - Number(manual.fee)).toFixed(2) : "";

  async function upload(file: File) {
    setBusy(true);
    setUploadError(null);
    setResult(null);
    const form = new FormData();
    form.append("cms_partner_id", cmsId);
    form.append("month", month);
    if (reference) form.append("reference", reference);
    form.append("file", file);
    try {
      const r = await api<StatementImport>("/finance/statements/import", { method: "POST", form });
      setResult(r);
      if (r.statement) onSaved(`Statement file saved (version ${r.statement.version}).`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveManual(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    try {
      await api("/finance/statements", {
        method: "PUT",
        json: {
          cms_partner_id: cmsId,
          month,
          currency: cur,
          gross_amount: manual.gross,
          fee_amount: manual.fee,
          net_amount: net,
          reference: manual.reference || null,
        },
      });
      setDialog(null);
      onSaved("Statement totals saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setErrors({
        [fieldFor(
          message,
          [
            ["gross", "gross"],
            ["fee", "fee"],
            ["net", "fee"],
          ],
          "form",
        )]: message,
      });
    }
  }

  const counts = reconciliation.reduce<Partial<Record<ReconStatus, number>>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-6">
      {part !== "reconciliation" && (
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">
                {name}&apos;s statement vs our calculation
                <InfoTip text={HELP.statement} />
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload the CMS&apos;s own breakdown for {formatMonth(month)} to check every channel, or type just the totals.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setManual(
                    statement
                      ? {
                          gross: String(Number(statement.gross_amount)),
                          fee: String(Number(statement.fee_amount)),
                          reference: statement.reference ?? "",
                        }
                      : { gross: "", fee: "", reference: "" },
                  );
                  setErrors({});
                  setDialog("manual");
                }}
              >
                <Pencil />
                Type totals
              </Button>
              <Button
                onClick={() => {
                  setResult(null);
                  setUploadError(null);
                  setReference(statement?.reference ?? "");
                  setDialog("upload");
                }}
              >
                <Upload />
                Upload statement file
              </Button>
            </div>
          </div>

          {statement ? (
            <>
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {statement.source === "file" ? (
                  <>
                    From file <span className="font-medium text-foreground">{statement.file_name}</span> · {statement.line_count} channel lines
                  </>
                ) : (
                  <>Totals typed in</>
                )}
                <span>· version {statement.version}</span>
                {statement.uploaded_by && <span>· {statement.uploaded_by}</span>}
                {statement.updated_at && <span>· {formatDateTime(statement.updated_at)}</span>}
                {statement.reference && <span>· ref {statement.reference}</span>}
                {statement.source === "file" && (
                  <a href={`/api/finance/statements/${statement.id}/file`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Download className="h-3.5 w-3.5" />
                    Download original
                  </a>
                )}
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Totals</TableHead>
                      <TableHead className="text-right">Our calculation</TableHead>
                      <TableHead className="text-right">Their statement</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        ["Gross", summary.gross, statement.gross_amount],
                        ...(Number(summary.tax) > 0 || Number(statement.tax_amount ?? 0) > 0
                          ? [["Tax withheld", summary.tax, statement.tax_amount ?? "0"]]
                          : []),
                        ["CMS fee", summary.fee, statement.fee_amount],
                        ["Net", summary.net, statement.net_amount],
                      ] as [string, string | null, string][]
                    ).map(([label, ours, theirs]) => {
                      const diff = ours === null ? null : Number(theirs) - Number(ours);
                      return (
                        <TableRow key={label} className={label === "Net" ? "font-semibold" : ""}>
                          <TableCell>{label}</TableCell>
                          <TableCell className="text-right">{ours === null ? "—" : money(ours, cur)}</TableCell>
                          <TableCell className="text-right">{money(theirs, statement.currency)}</TableCell>
                          <TableCell className={cn("text-right", diff ? "text-amber-600" : "text-emerald-600")}>
                            {diff === null ? "—" : diff === 0 ? "✓ same" : money(diff, cur)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4">
                {Number(summary.variance ?? 0) === 0 ? (
                  <Notice kind="success">The statement total matches our numbers.</Notice>
                ) : (
                  <Notice kind="warning">
                    {name} says the net is {money(summary.variance, cur)} different.
                    {reconciliation.length > 0 ? " The channel lines below show where." : " Upload their file to see which channel causes it."} If it
                    is a chargeback, tax or a late revision, record it under Adjustments so the outstanding balance is right.
                  </Notice>
                )}
              </div>
            </>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No statement yet. When {name} sends its {formatMonth(month)} statement, upload its file (best — every channel is checked) or type its
              totals.
            </p>
          )}
        </section>
      )}

      {part === "reconciliation" && statement?.source !== "file" && (
        <section className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          {statement
            ? `${name}'s ${formatMonth(month)} totals were typed in, so there are no channel lines to compare. Upload their file under Statements to check every channel.`
            : `No statement for ${formatMonth(month)} yet. Upload ${name}'s file under Statements and every channel is compared here.`}
        </section>
      )}

      {part !== "statement" && statement?.source === "file" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 p-6 pb-4">
            <div>
              <h3 className="text-lg font-semibold">
                Channel by channel
                <InfoTip text="Each line of their file next to our numbers for the same channel. Problems are listed first." />
              </h3>
              <p className="text-sm text-muted-foreground">All amounts in {cur}.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STATUS) as ReconStatus[])
                .filter((k) => counts[k])
                .map((k) => (
                  <Pill key={k} tone={STATUS[k].tone}>
                    {counts[k]} {STATUS[k].label.toLowerCase()}
                  </Pill>
                ))}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Our gross</TableHead>
                <TableHead className="text-right">Their gross</TableHead>
                <TableHead className="text-right">Our net</TableHead>
                <TableHead className="text-right">Their net</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliation.map((r) => (
                <TableRow key={`${r.channel_id ?? r.external_id}-${r.status}`}>
                  <TableCell>
                    <p className="font-medium">{r.channel_name}</p>
                    {r.external_id && <p className="font-mono text-xs text-muted-foreground">{r.external_id}</p>}
                  </TableCell>
                  <TableCell className="text-right">{r.our_gross === null ? "—" : money(r.our_gross, cur)}</TableCell>
                  <TableCell className="text-right">{r.their_gross === null ? "—" : money(r.their_gross, cur)}</TableCell>
                  <TableCell className="text-right">{r.our_net === null ? "—" : money(r.our_net, cur)}</TableCell>
                  <TableCell className="text-right">{r.their_net === null ? "—" : money(r.their_net, cur)}</TableCell>
                  <TableCell className={cn("text-right font-semibold", r.status !== "match" && r.difference && "text-amber-600")}>
                    {r.status === "match" ? "—" : r.difference === null ? "—" : money(r.difference, cur)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                    <InfoTip text={STATUS[r.status].help} />
                  </TableCell>
                </TableRow>
              ))}
              {reconciliation.length === 0 && <EmptyRow colSpan={7}>No lines to compare.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      <Dialog
        open={dialog === "upload"}
        onClose={() => setDialog(null)}
        title={`Upload ${name}'s statement`}
        description={`For ${formatMonth(month)}, in ${cur}. A new upload replaces the previous one (kept in History).`}
        wide
      >
        <ol className="space-y-5">
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">1</span>
            <div className="flex-1 space-y-2">
              <p className="font-semibold">Use their file, or copy it into this template</p>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/finance/statements/template" download>
                  <Download />
                  cms-statement-template.csv
                </a>
              </Button>
              <div className="overflow-hidden rounded-xl border text-sm">
                <Table>
                  <TableBody>
                    {COLUMNS.map(([col, what]) => (
                      <TableRow key={col}>
                        <TableCell className="w-36 font-mono text-xs font-semibold">{col}</TableCell>
                        <TableCell className="text-muted-foreground">{what}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">Column names like “Gross Revenue”, “CMS Fee” or “Channel ID” are understood too.</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">2</span>
            <div className="flex-1">
              <Field id="st-up-ref" label="Statement number / reference (optional)">
                <Input id="st-up-ref" placeholder="e.g. CMSA-2026-09" value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">3</span>
            <div className="flex-1 space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
              >
                <FileUp className="h-6 w-6" />
                {busy ? "Checking the file…" : result ? "Upload a different file" : "Click to choose the statement CSV"}
              </button>
              {uploadError && <Notice kind="error">{uploadError}</Notice>}
              {result && (
                <div className="space-y-3">
                  {result.statement ? (
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{result.lines_matched}</p>
                        <p className="text-muted-foreground">matched to our channels</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
                        <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{result.lines_unknown}</p>
                        <p className="text-muted-foreground">unknown channel IDs</p>
                      </div>
                      <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
                        <p className="text-2xl font-bold text-red-700 dark:text-red-400">{result.errors.length}</p>
                        <p className="text-muted-foreground">lines skipped</p>
                      </div>
                    </div>
                  ) : (
                    <Notice kind="error">Nothing was saved — no usable line in the file.</Notice>
                  )}
                  {result.errors.length > 0 && (
                    <ul className="max-h-40 space-y-1 overflow-auto rounded-xl border p-3 text-sm">
                      {result.errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-mono text-muted-foreground">Line {e.line}:</span>{" "}
                          <span className="text-red-600 dark:text-red-400">{e.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {result.statement && (
                    <p className="text-sm">
                      Their totals: gross {money(result.statement.gross_amount, cur)} · fee {money(result.statement.fee_amount, cur)} · net{" "}
                      <span className="font-semibold">{money(result.statement.net_amount, cur)}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </li>
        </ol>
        <DialogFooter>
          <Button variant={result?.statement ? "default" : "outline"} onClick={() => setDialog(null)}>
            {result?.statement ? "See the comparison" : "Cancel"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={dialog === "manual"}
        onClose={() => setDialog(null)}
        title={`${name} statement totals · ${formatMonth(month)}`}
        description="Use this when the CMS only sent totals. Typed totals replace any uploaded file."
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveManual}>
          <Field id="st-gross" label={`Gross on their statement (${cur}) *`} error={errors.gross}>
            <Input
              id="st-gross"
              type="number"
              step="0.01"
              min="0"
              required
              className={errors.gross ? INVALID : undefined}
              value={manual.gross}
              onChange={(e) => setManual({ ...manual, gross: e.target.value })}
            />
          </Field>
          <Field id="st-fee" label={`Their fee (${cur}) *`} error={errors.fee}>
            <Input
              id="st-fee"
              type="number"
              step="0.01"
              min="0"
              required
              className={errors.fee ? INVALID : undefined}
              value={manual.fee}
              onChange={(e) => setManual({ ...manual, fee: e.target.value })}
            />
          </Field>
          <div className="rounded-xl bg-muted/50 p-3 text-sm sm:col-span-2">
            Net on their statement: <span className="font-semibold">{net ? money(net, cur) : "—"}</span>
            {net && summary.net !== null && (
              <span className="text-muted-foreground">
                {" "}
                · ours {money(summary.net, cur)} · difference {money(Number(net) - Number(summary.net), cur)}
              </span>
            )}
          </div>
          <Field id="st-ref" label="Statement number / reference" className="sm:col-span-2">
            <Input id="st-ref" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Save totals</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
