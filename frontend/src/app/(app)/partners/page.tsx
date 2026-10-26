"use client";

import { ArrowRight, ChevronRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyRow } from "@/components/data-table";
import { PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { PartnerForm } from "@/components/partner-form";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr } from "@/lib/finance";
import type { DealPartner } from "@/lib/types";

export default function PartnersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DealPartner[] | null>(null);
  const [editing, setEditing] = useState<DealPartner | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<DealPartner[]>("/partners")
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (!rows) return error ? <Notice kind="error">{error}</Notice> : <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal partners"
        description="People who buy a licence together with you (e.g. Vanshika takes 50% of a Sony deal). They pay their % of the licence fee, run their own channels, and are paid those channels' earnings after the CMS fee — once the CMS pays you — less TDS."
        actions={
          <Button size="lg" onClick={() => setEditing("new")}>
            <Plus />
            New partner
          </Button>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Deals</TableHead>
              <TableHead className="text-right">Channels</TableHead>
              <TableHead className="text-right">TDS</TableHead>
              <TableHead className="text-right">Earned</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="whitespace-nowrap text-right">Still to pay</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p, idx) => (
              <TableRow key={p.id} className="group cursor-pointer hover:bg-primary/5" onClick={() => router.push(`/partners/${p.id}`)}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                <TableCell>
                  <Link
                    href={`/partners/${p.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 group-hover:underline"
                  >
                    {p.name}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                  {p.email && <p className="text-xs text-muted-foreground">{p.email}</p>}
                </TableCell>
                <TableCell className="text-sm">
                  {p.deals.length ? (
                    p.deals.map((d) => (
                      <p key={d.deal_id}>
                        {d.title} <span className="text-muted-foreground">· {Number(d.share_pct)}%</span>
                      </p>
                    ))
                  ) : (
                    <span className="text-muted-foreground">Not on a deal yet</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.channel_count}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.tds_pct === null ? <span className="text-xs text-amber-700 dark:text-amber-400">Not set</span> : `${Number(p.tds_pct)}%`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{compactInr(p.earned)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{compactInr(p.paid)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {compactInr(p.outstanding)}
                  {Number(p.waiting) > 0 && (
                    <span className="block whitespace-nowrap text-xs font-normal text-muted-foreground">+{compactInr(p.waiting)} after CMS pays</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill active={p.is_active} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" asChild>
                      <Link href={`/partners/${p.id}`}>
                        Open <ArrowRight />
                      </Link>
                    </Button>
                    <Button variant="outline" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                      <Pencil />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={10}>No deal partners yet. Add one, then give them a % on a deal (Deal → Partners tab).</EmptyRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        wide
        title={editing === "new" ? "New deal partner" : `Edit ${editing?.name ?? ""}`}
      >
        {editing !== null && (
          <PartnerForm
            partner={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(p) => {
              setNotice(editing === "new" ? `${p.name} added. Next: open a deal → Partners tab and give them their %.` : `${p.name} saved.`);
              setEditing(null);
              load();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
