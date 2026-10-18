"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Field, TEXTAREA } from "@/components/deal/form-bits";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { type SlotAction, SlotAssignPanel, slotActionTitle } from "@/components/slot-assign-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { SLOT_STATUS_LABELS, SLOT_STATUS_TONES, formatDate } from "@/lib/deals";
import type { Deal, Slot, SlotHistoryItem, SlotStatus } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";

const SLOT_SORT = {
  code: (s: Slot) => `${s.platform === "youtube" ? 0 : 1}-${String(s.number).padStart(3, "0")}`,
  status: (s: Slot) => SLOT_STATUS_LABELS[s.status],
};

function SlotHistory({ dealId, refreshKey }: { dealId: string; refreshKey: number }) {
  const [rows, setRows] = useState<SlotHistoryItem[]>([]);
  useEffect(() => {
    api<SlotHistoryItem[]>(`/deals/${dealId}/assignments`).then(setRows).catch(() => {});
  }, [dealId, refreshKey]);
  const ended: Record<string, string> = { replaced: "Replaced", unassigned: "Removed" };
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="p-6 pb-4">
        <h3 className="text-lg font-semibold">Slot history</h3>
        <p className="text-sm text-muted-foreground">Every channel that has held a slot in this deal. Nothing is ever deleted.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Slot</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>How</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-mono font-semibold">{h.slot_code}</TableCell>
              <TableCell>
                <Link href={`/channels/${h.channel_id}`} className="font-medium hover:text-primary">
                  {h.channel_name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(h.start_date)}</TableCell>
              <TableCell className="whitespace-nowrap">{h.end_date ? formatDate(h.end_date) : "Now"}</TableCell>
              <TableCell className="text-muted-foreground">
                {h.start_reason === "replacement" ? "Replacement" : "Assigned"}
                {h.end_reason && ` · ${ended[h.end_reason]}`}
                {h.notes && <span className="block text-xs">{h.notes}</span>}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={5}>No channel has held a slot yet.</EmptyRow>}
        </TableBody>
      </Table>
    </section>
  );
}

/** PDF slide 5: which channel holds each authorised slot, its CMS, status and manager. */
export function DealSlots({ deal, refreshKey, onChange }: { deal: Deal; refreshKey: number; onChange: (message?: string) => void }) {
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [acting, setActing] = useState<{ slot: Slot; action: SlotAction } | null>(null);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [edit, setEdit] = useState<{ status: SlotStatus; notes: string }>({ status: "unassigned", notes: "" });
  const [error, setError] = useState<string | null>(null);

  const rows = deal.slots.filter((s) => (!platform || s.platform === platform) && (!status || s.status === status));
  const table = useClientTable({ rows, sortBy: SLOT_SORT, initialSort: { key: "code", dir: "asc" }, resetKey: `${platform}|${status}` });

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await api(`/deals/${deal.id}/slots/${editing.id}`, { method: "PATCH", json: { status: edit.status, notes: edit.notes || null } });
      setEditing(null);
      onChange(`${editing.code} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the slot");
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div>
            <h3 className="text-lg font-semibold">Slots</h3>
            <p className="text-sm text-muted-foreground">
              A slot is the contract&apos;s permission for one channel or page. Replacing a channel keeps the old one&apos;s history.
            </p>
          </div>
          <div className="flex gap-2">
            <NativeSelect aria-label="Filter slots by platform" className="w-36" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">All platforms</option>
              <option value="youtube">YouTube</option>
              <option value="facebook">Facebook</option>
            </NativeSelect>
            <NativeSelect aria-label="Filter slots by status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(SLOT_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Slot" sortKey="code" sort={table.sort} onSort={table.toggleSort} />
              <TableHead>Channel</TableHead>
              <TableHead>CMS</TableHead>
              <TableHead>Manager</TableHead>
              <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono font-semibold">{s.code}</TableCell>
                <TableCell>
                  {s.channel_id ? (
                    <>
                      <Link href={`/channels/${s.channel_id}`} className="font-medium hover:text-primary">
                        {s.channel_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">since {s.since ? formatDate(s.since) : "—"}</p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Empty</span>
                  )}
                  {s.notes && <p className="text-xs italic text-muted-foreground">{s.notes}</p>}
                </TableCell>
                <TableCell>{s.cms_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{s.manager_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <Pill tone={SLOT_STATUS_TONES[s.status]}>{SLOT_STATUS_LABELS[s.status]}</Pill>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {s.channel_id ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setActing({ slot: s, action: "replace" })}>
                        Replace
                      </Button>{" "}
                      <Button variant="ghost" size="sm" onClick={() => setActing({ slot: s, action: "unassign" })}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setActing({ slot: s, action: "assign" })}>
                      Assign channel
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${s.code}`}
                    onClick={() => {
                      setEditing(s);
                      setEdit({ status: s.status, notes: s.notes ?? "" });
                      setError(null);
                    }}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {table.total === 0 && <EmptyRow colSpan={6}>No slots match these filters.</EmptyRow>}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="slots"
        />
      </section>

      <SlotHistory dealId={deal.id} refreshKey={refreshKey} />

      <Dialog
        open={acting !== null}
        onClose={() => setActing(null)}
        title={acting ? slotActionTitle(acting.action, acting.slot) : ""}
        description={acting?.slot.channel_name && acting.action !== "assign" ? `Now held by ${acting.slot.channel_name}` : undefined}
        wide
      >
        {acting && (
          <SlotAssignPanel
            dealId={deal.id}
            slot={acting.slot}
            action={acting.action}
            onCancel={() => setActing(null)}
            onDone={(message) => {
              setActing(null);
              onChange(message);
            }}
          />
        )}
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.code}` : ""}>
        {editing && (
          <form onSubmit={saveEdit} className="space-y-4">
            <Field id="sl-status" label="Status" hint={editing.channel_id ? "Active means the owner has approved this channel." : "An empty slot can only be unassigned or reserved."}>
              <NativeSelect id="sl-status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as SlotStatus })}>
                {Object.entries(SLOT_STATUS_LABELS)
                  .filter(([v]) => v !== "replaced")
                  .map(([v, l]) => (
                    <option key={v} value={v} disabled={editing.channel_id ? v === "unassigned" : v === "pending_whitelist" || v === "active"}>
                      {l}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field id="sl-notes" label="Note">
              <textarea id="sl-notes" rows={2} maxLength={500} className={TEXTAREA} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        )}
      </Dialog>
    </div>
  );
}
