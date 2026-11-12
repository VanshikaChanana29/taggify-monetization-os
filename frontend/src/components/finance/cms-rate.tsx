"use client";

import { useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatMonth } from "@/lib/finance";
import type { CmsMonth } from "@/lib/types";

const SOURCE: Record<string, string> = {
  manual: "set by you",
  sheet: "from the CMS's sheet",
  company: "the company's rate for the month",
};

/** The CMS's own rate for the month: from its sheet, or set by hand (which wins). */
export function CmsRateLine({
  cmsId,
  month,
  currency,
  base,
  summary,
  onChanged,
}: {
  cmsId: string;
  month: string;
  currency: string;
  base: string;
  summary: CmsMonth;
  onChanged: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setRate(summary.fx_rate ? String(Number(summary.fx_rate)) : "");
    setError(null);
    setOpen(true);
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(false);
      onChanged(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rate");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(
      () => api(`/finance/settlements/${cmsId}/rate`, { method: "PUT", json: { month, rate } }),
      `${summary.cms_name}'s ${formatMonth(month)} rate set to ${rate}.`,
    );
  const useSheet = () =>
    run(
      () => api(`/finance/settlements/${cmsId}/rate?month=${month}`, { method: "DELETE" }),
      `${summary.cms_name}'s ${formatMonth(month)} rate is back to the sheet's.`,
    );

  const sheet = summary.sheet_fx_rate ? Number(summary.sheet_fx_rate) : null;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {formatMonth(month)} rate:{" "}
        {summary.fx_rate ? (
          <>
            <span className="font-semibold text-foreground">
              1 {currency} = {Number(summary.fx_rate)} {base}
            </span>{" "}
            · {SOURCE[summary.fx_source ?? ""] ?? ""}
            {summary.fx_source === "manual" && sheet !== null && ` (sheet says ${sheet})`}
          </>
        ) : (
          <span className="font-semibold text-amber-700 dark:text-amber-400">not set</span>
        )}{" "}
        <button type="button" onClick={start} className="font-medium text-primary underline-offset-2 hover:underline">
          {summary.fx_rate ? "Change" : "Set rate"}
        </button>
      </p>

      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`${summary.cms_name} · ${formatMonth(month)} rate`}
        description={`What 1 ${currency} is in ${base} for this CMS this month. Used for its gross, tax, fee, net and payments in ${base}.`}
      >
        <div className="space-y-3">
          <Input
            aria-label={`1 ${currency} in ${base}`}
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 86.10"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {sheet !== null
              ? `The CMS's sheet says ${sheet}. A rate set here wins over the sheet, also when a sheet is uploaded again.`
              : "A rate set here wins over the rate on the CMS's sheet, also when a sheet is uploaded later."}
          </p>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <DialogFooter>
          {summary.fx_source === "manual" && (
            <Button variant="outline" disabled={busy} onClick={useSheet} className="sm:mr-auto">
              {sheet !== null ? `Use the sheet's ${sheet}` : "Remove my rate"}
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !(Number(rate) > 0)} onClick={save}>
            {busy ? "Saving…" : "Save rate"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
