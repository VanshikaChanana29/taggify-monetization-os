"use client";

import { useEffect, useState } from "react";

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, EmptyRow, FilterBar, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { useOrganization } from "@/components/session-provider";
import { Tag } from "@/components/status-pill";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AuditActor, AuditLog, Page } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Logged in",
  "auth.logout": "Logged out",
  "auth.login_failed": "Failed login attempt",
  "auth.login_denied": "Login blocked (access removed)",
  "auth.locked": "Account locked after failed attempts",
  "auth.password_changed": "Changed own password",
  "auth.switch_organization": "Switched company",
  "user.created": "Added a founder",
  "user.deactivated": "Removed a founder's access",
  "user.activated": "Restored a founder's access",
  "user.password_reset": "Reset a founder's password",
  "user.added_to_org": "Gave a founder access",
  "org.created": "Company created",
  "owner.created": "Added a content owner",
  "owner.updated": "Edited a content owner",
  "deal.created": "Created a deal",
  "deal.updated": "Edited a deal",
  "slot.updated": "Updated a deal slot",
  "slot.assigned": "Assigned a channel to a slot",
  "slot.replaced": "Replaced a slot's channel",
  "slot.unassigned": "Removed a channel from a slot",
  "channel.created": "Added a channel",
  "channel.updated": "Edited a channel",
  "channel.manager_changed": "Changed a channel's manager",
  "cms.created": "Added a CMS partner",
  "cms.updated": "Edited a CMS partner",
  "employee.created": "Added a person",
  "employee.updated": "Edited a person",
  "role.created": "Added a role",
  "role.updated": "Edited a role",
  "role.deleted": "Deleted a role",
  "team.created": "Created a team",
  "team.updated": "Edited a team",
  "team.lead_changed": "Changed a team lead",
  "revenue.imported": "Imported revenue",
  "fx.set": "Set an FX rate",
  "cms.fee_schedule_added": "Added CMS fee tiers",
  "cms.fee_schedule_deleted": "Deleted CMS fee tiers",
  "cms.statement_saved": "Saved a CMS statement",
  "cms.receipt_added": "Recorded cash received",
  "cms.receipt_deleted": "Deleted a cash receipt",
  "cms.adjustment_added": "Added a CMS adjustment",
  "cms.adjustment_deleted": "Deleted a CMS adjustment",
  "incentive.rate_added": "Set an incentive rate",
  "incentive.rate_deleted": "Deleted an incentive rate",
  "incentive.computed": "Calculated incentives",
  "incentive.approved": "Approved incentives",
  "incentive.reopened": "Reopened incentives",
  "month.closed": "Closed a month",
  "month.reopened": "Reopened a month",
  "deal.installment_added": "Added an installment",
  "deal.installment_paid": "Marked an installment paid",
  "deal.installment_unpaid": "Marked an installment unpaid",
  "deal.installment_deleted": "Deleted an installment",
  "deal.expense_added": "Added a deal expense",
  "deal.expense_deleted": "Deleted a deal expense",
  "episode.added": "Added episode details",
  "episode.updated": "Edited episode details",
  "episode.deleted": "Deleted episode details",
  "episode.imported": "Imported episodes",
  "document.uploaded": "Uploaded a deal document",
  "document.deleted": "Deleted a deal document",
};

/** "What" filter: each option matches a group of actions. */
const ACTION_GROUPS: Record<string, { label: string; actions: string[] }> = {
  logins: { label: "Logins & logouts", actions: ["auth.login", "auth.logout"] },
  security: {
    label: "Failed or blocked logins",
    actions: ["auth.login_failed", "auth.login_denied", "auth.locked"],
  },
  access: {
    label: "Founder access changes",
    actions: ["user.created", "user.deactivated", "user.activated", "user.added_to_org"],
  },
  passwords: { label: "Password changes", actions: ["auth.password_changed", "user.password_reset"] },
  switches: { label: "Company switches", actions: ["auth.switch_organization"] },
  deals: {
    label: "Deals & content owners",
    actions: [
      "deal.created",
      "deal.updated",
      "slot.updated",
      "owner.created",
      "owner.updated",
      "episode.added",
      "episode.updated",
      "episode.deleted",
      "episode.imported",
      "document.uploaded",
      "document.deleted",
    ],
  },
  channels: {
    label: "Channels, slots & CMS",
    actions: [
      "slot.assigned",
      "slot.replaced",
      "slot.unassigned",
      "channel.created",
      "channel.updated",
      "channel.manager_changed",
      "cms.created",
      "cms.updated",
    ],
  },
  finance: {
    label: "Revenue & finance",
    actions: [
      "revenue.imported",
      "fx.set",
      "cms.fee_schedule_added",
      "cms.fee_schedule_deleted",
      "cms.statement_saved",
      "cms.receipt_added",
      "cms.receipt_deleted",
      "cms.adjustment_added",
      "cms.adjustment_deleted",
      "incentive.rate_added",
      "incentive.rate_deleted",
      "incentive.computed",
      "incentive.approved",
      "incentive.reopened",
      "month.closed",
      "month.reopened",
      "deal.installment_added",
      "deal.installment_paid",
      "deal.installment_unpaid",
      "deal.installment_deleted",
      "deal.expense_added",
      "deal.expense_deleted",
    ],
  },
  people: {
    label: "People, teams & roles",
    actions: [
      "employee.created",
      "employee.updated",
      "channel.manager_changed",
      "team.created",
      "team.updated",
      "team.lead_changed",
      "role.created",
      "role.updated",
      "role.deleted",
    ],
  },
};

const WARNING_ACTIONS = new Set(ACTION_GROUPS.security.actions);

type Filters = { group: string; userId: string; from: string; to: string };
const NO_FILTERS: Filters = { group: "", userId: "", from: "", to: "" };

function describe(log: AuditLog): string {
  const { email, title, name, slot } = log.details;
  const subject = [title, name, email].find((v) => typeof v === "string") as string | undefined;
  return [subject, typeof slot === "string" ? slot : undefined].filter(Boolean).join(" · ");
}

export default function ActivityPage() {
  const organization = useOrganization();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortState<"when">>({ key: "when", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<Page<AuditLog> | null>(null);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AuditActor[]>("/audit-logs/actors").then(setActors).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort: sort.dir === "desc" ? "newest" : "oldest",
    });
    ACTION_GROUPS[filters.group]?.actions.forEach((a) => params.append("action", a));
    if (filters.userId) params.set("user_id", filters.userId);
    if (filters.from) params.set("date_from", filters.from);
    if (filters.to) params.set("date_to", filters.to);

    let cancelled = false;
    api<Page<AuditLog>>(`/audit-logs?${params}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [filters, sort, page, pageSize]);

  function updateFilters(change: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  }

  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="space-y-8">
      <PageHeader title="Activity" description={`Who did what in ${organization.name}.`} />
      {error && <Notice kind="error">{error}</Notice>}

      <FilterBar active={filtered} onClear={() => updateFilters(NO_FILTERS)}>
        <NativeSelect
          aria-label="Filter by type"
          className="w-56"
          value={filters.group}
          onChange={(e) => updateFilters({ group: e.target.value })}
        >
          <option value="">All activity</option>
          {Object.entries(ACTION_GROUPS).map(([key, group]) => (
            <option key={key} value={key}>
              {group.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by person"
          className="w-48"
          value={filters.userId}
          onChange={(e) => updateFilters({ userId: e.target.value })}
        >
          <option value="">Everyone</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <Input
            type="date"
            className="w-40"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => updateFilters({ from: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <Input
            type="date"
            className="w-40"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => updateFilters({ to: e.target.value })}
          />
        </label>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="When"
                sortKey="when"
                sort={sort}
                onSort={() => {
                  setSort((s) => ({ key: "when", dir: s.dir === "desc" ? "asc" : "desc" }));
                  setPage(1);
                }}
              />
              <TableHead>Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(log.created_at)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={log.user_name ?? "System"} className="h-8 w-8 text-xs" />
                    <span className="font-medium">{log.user_name ?? "System"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {WARNING_ACTIONS.has(log.action) ? (
                    <Tag>{ACTION_LABELS[log.action] ?? log.action}</Tag>
                  ) : (
                    (ACTION_LABELS[log.action] ?? log.action)
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{describe(log)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {log.ip ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {data && data.total === 0 && (
              <EmptyRow colSpan={5}>No activity matches these filters.</EmptyRow>
            )}
          </TableBody>
        </Table>
        {data && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            pageSizes={PAGE_SIZES}
            noun="events"
          />
        )}
      </div>
    </div>
  );
}
