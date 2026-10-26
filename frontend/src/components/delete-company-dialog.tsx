"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { InlineLoader } from "@/components/loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { AdminOrganization } from "@/lib/types";

type Check = {
  name: string;
  is_current: boolean;
  counts: { content_owners: number; deals: number; channels: number; people: number; revenue_rows: number; files: number; founders: number };
};

const LABELS: [keyof Check["counts"], string][] = [
  ["channels", "channels"],
  ["deals", "deals"],
  ["content_owners", "content owners"],
  ["people", "people"],
  ["revenue_rows", "revenue entries"],
  ["files", "uploaded files"],
  ["founders", "founder logins to this company"],
];

/** Delete a company — only after reading what goes with it and typing its name. */
export function DeleteCompanyDialog({
  company,
  onClose,
  onDeleted,
}: {
  company: AdminOrganization | null;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCheck(null);
    setTyped("");
    setError(null);
    if (!company) return;
    api<Check>(`/admin/organizations/${company.id}/delete-check`)
      .then(setCheck)
      .catch((err: Error) => setError(err.message));
  }, [company]);

  async function remove() {
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/organizations/${company.id}`, { method: "DELETE", json: { confirm_name: typed } });
      onDeleted(company.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  const matches = company !== null && typed.trim() === company.name;
  return (
    <Dialog open={company !== null} onClose={onClose} title={company ? `Delete ${company.name}?` : "Delete company"}>
      {company && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">This permanently deletes {company.name} and all of its data. It cannot be undone.</p>
              {!check ? (
                <InlineLoader />
              ) : (
                <ul className="list-disc space-y-0.5 pl-5">
                  {LABELS.filter(([k]) => check.counts[k] > 0).map(([k, label]) => (
                    <li key={k}>
                      <b>{check.counts[k].toLocaleString("en-IN")}</b> {label}
                    </li>
                  ))}
                  <li>every deal payment, CMS statement, bank receipt, incentive, partner payout and month close of this company</li>
                </ul>
              )}
              <p>
                Its founders can no longer open it (they keep their login only if they belong to another company). The activity log keeps a record of
                the deletion.
              </p>
            </div>
          </div>

          {check?.is_current ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              You are working in {company.name} right now. Switch to another company (top bar) first, then delete it.
            </p>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="del-name">
                Type <b>{company.name}</b> to confirm
              </Label>
              <Input id="del-name" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={company.name} />
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={!matches || busy || !check || check.is_current} onClick={remove}>
              {busy ? "Deleting…" : `Delete ${company.name} forever`}
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
