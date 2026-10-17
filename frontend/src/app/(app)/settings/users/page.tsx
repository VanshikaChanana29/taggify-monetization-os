"use client";

import { UserCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";

import {
  EmptyRow,
  FilterBar,
  SearchInput,
  SortableHead,
  TablePagination,
} from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { useOrganization, useSession } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { StatusPill } from "@/components/status-pill";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";
import { timeValue, useClientTable } from "@/lib/use-client-table";

const SORT_BY = {
  name: (m: Member) => m.full_name,
  status: (m: Member) => (m.is_active ? 0 : 1),
  last_login: (m: Member) => timeValue(m.last_login_at),
  added: (m: Member) => timeValue(m.added_at),
};

type Status = "" | "active" | "removed";

export default function UsersPage() {
  const { me } = useSession();
  const organization = useOrganization();
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Member[]>("/users")
      .then(setMembers)
      .catch((err: Error) => setError(err.message));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = members.filter(
    (m) =>
      (!q || m.full_name.toLowerCase().includes(q) || m.email.includes(q)) &&
      (!status || (status === "active") === m.is_active),
  );
  const table = useClientTable({
    rows: filtered,
    sortBy: SORT_BY,
    initialSort: { key: "name", dir: "asc" },
    resetKey: `${q}|${status}`,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Founders"
        description={`Who can log in to ${organization.name}. Users are added and removed by the super admin.`}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <StatCard label="Total founders" value={members.length} icon={Users} />
        <StatCard
          label="Active"
          value={members.filter((m) => m.is_active).length}
          icon={UserCheck}
          tone="green"
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <FilterBar
        active={Boolean(q || status)}
        onClear={() => {
          setQuery("");
          setStatus("");
        }}
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search name or email…" />
        <NativeSelect
          aria-label="Filter by status"
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="removed">Removed</option>
        </NativeSelect>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Founder" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead
                label="Last login"
                sortKey="last_login"
                sort={table.sort}
                onSort={table.toggleSort}
              />
              <SortableHead label="Added" sortKey="added" sort={table.sort} onSort={table.toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-4">
                    <UserAvatar name={m.full_name} seed={m.id} />
                    <div>
                      <p className="font-semibold">
                        {m.full_name}{" "}
                        {m.id === me.user.id && (
                          <span className="font-normal text-muted-foreground">(you)</span>
                        )}
                      </p>
                      <p className="text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill active={m.is_active} label={m.is_active ? "Active" : "Removed"} />
                </TableCell>
                <TableCell>{formatDateTime(m.last_login_at)}</TableCell>
                <TableCell>{formatDateTime(m.added_at)}</TableCell>
              </TableRow>
            ))}
            {table.total === 0 && <EmptyRow colSpan={4}>No founders match these filters.</EmptyRow>}
          </TableBody>
        </Table>
        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          noun="founders"
        />
      </div>
    </div>
  );
}
