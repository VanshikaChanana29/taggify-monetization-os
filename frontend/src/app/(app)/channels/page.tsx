"use client";

import { Plus, Tv, UserX, Unlink, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ChannelForm } from "@/components/channel-form";
import { EmptyRow, FilterBar, SearchInput, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { ChannelListItem, ChannelsSummary, CmsPartner, DealListItem, Employee, Page } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";

type SortKey = "name" | "platform" | "created";
type Filters = { platform: string; cms: string; deal: string; manager: string; slot: string; status: string };
const NO_FILTERS: Filters = { platform: "", cms: "", deal: "", manager: "", slot: "", status: "" };

export default function ChannelsPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<ChannelsSummary | null>(null);
  const [cmsList, setCmsList] = useState<CmsPartner[]>([]);
  const [deals, setDeals] = useState<DealListItem[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<ChannelListItem> | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CmsPartner[]>("/cms-partners").then(setCmsList).catch(() => {});
    api<Page<DealListItem>>("/deals?page_size=100&sort=title").then((p) => setDeals(p.items)).catch(() => {});
    api<Employee[]>("/employees").then(setPeople).catch(() => {});
  }, []);

  useEffect(() => {
    api<ChannelsSummary>("/channels/summary").then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort: sort.key,
      direction: sort.dir,
    });
    if (q.trim()) params.set("q", q.trim());
    if (filters.platform) params.set("platform", filters.platform);
    if (filters.cms) params.set("cms_partner_id", filters.cms);
    if (filters.deal) params.set("deal_id", filters.deal);
    if (filters.manager) params.set("manager_id", filters.manager);
    if (filters.slot) params.set("slot", filters.slot);
    if (filters.status) params.set("status", filters.status);
    return api<Page<ChannelListItem>>(`/channels?${params}`);
  }, [q, filters, sort, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => !cancelled && setData(r))
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const update = (change: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  };
  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  };
  const anyFilter = Boolean(search) || Object.values(filters).some(Boolean);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Channels"
        description="YouTube channels and Facebook pages — which deal slot each holds, its CMS, and who manages it."
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus />
            New channel
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active channels" value={summary?.active_channels ?? "—"} icon={Tv} />
        <StatCard label="Holding a deal slot" value={summary?.in_slots ?? "—"} icon={Link2} tone="green" />
        <StatCard label="Without a slot" value={summary?.without_slot ?? "—"} icon={Unlink} tone="amber" />
        <StatCard label="Without a manager" value={summary?.without_manager ?? "—"} icon={UserX} tone="amber" />
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {creating && (
        <ChannelForm
          channel={null}
          onCancel={() => setCreating(false)}
          onSaved={(saved) => router.push(`/channels/${saved.id}`)}
        />
      )}

      <FilterBar
        active={anyFilter}
        onClear={() => {
          setSearch("");
          update(NO_FILTERS);
        }}
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or channel ID…" />
        <NativeSelect aria-label="Filter by platform" className="w-36" value={filters.platform} onChange={(e) => update({ platform: e.target.value })}>
          <option value="">All platforms</option>
          <option value="youtube">YouTube</option>
          <option value="facebook">Facebook</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by CMS" className="w-40" value={filters.cms} onChange={(e) => update({ cms: e.target.value })}>
          <option value="">All CMS</option>
          {cmsList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by deal" className="w-48" value={filters.deal} onChange={(e) => update({ deal: e.target.value })}>
          <option value="">All deals</option>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by manager" className="w-44" value={filters.manager} onChange={(e) => update({ manager: e.target.value })}>
          <option value="">All managers</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by slot" className="w-40" value={filters.slot} onChange={(e) => update({ slot: e.target.value })}>
          <option value="">Any slot</option>
          <option value="assigned">In a slot</option>
          <option value="unassigned">No slot</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by status" className="w-36" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Channel" sortKey="name" sort={sort} onSort={toggleSort} />
              <SortableHead label="Platform" sortKey="platform" sort={sort} onSort={toggleSort} />
              <TableHead>CMS</TableHead>
              <TableHead>Deal · slot</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Team lead</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/channels/${c.id}`)}>
                <TableCell>
                  <Link href={`/channels/${c.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                    {c.name}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{c.external_id}</p>
                </TableCell>
                <TableCell>
                  <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                </TableCell>
                <TableCell>{c.cms_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {c.slots.length ? (
                    c.slots.map((s) => (
                      <p key={s.slot_id}>
                        {s.deal_title} · <span className="font-mono font-semibold">{s.slot_code}</span>
                      </p>
                    ))
                  ) : (
                    <span className="text-muted-foreground">No slot</span>
                  )}
                </TableCell>
                <TableCell>{c.manager?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{c.team_lead?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <StatusPill active={c.status === "active"} />
                </TableCell>
              </TableRow>
            ))}
            {data && data.total === 0 && (
              <EmptyRow colSpan={7}>{anyFilter ? "No channels match these filters." : "No channels yet — add your first one."}</EmptyRow>
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
            pageSizes={[25, 50, 100]}
            noun="channels"
          />
        )}
      </div>
    </div>
  );
}
