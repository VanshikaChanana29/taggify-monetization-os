"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { api } from "@/lib/api";

/**
 * A Delete button with a confirm popup. The server refuses anything with history (money,
 * slots, incentives…); its reason is shown in the popup, with what to do instead.
 */
export function DeleteButton({
  path,
  name,
  what,
  rule,
  onDeleted,
  size = "lg",
}: {
  path: string;
  name: string;
  what: string;
  rule: string;
  onDeleted: () => void;
  size?: "sm" | "lg" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "DELETE" });
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        className="text-red-600 hover:text-red-700 dark:text-red-400"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 />
        Delete
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Delete ${name}?`} description="This cannot be undone.">
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">{rule}</p>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : `Delete ${what}`}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
