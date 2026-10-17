"use client";

import { AlarmClock, Handshake, IndianRupee, Plus, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyRow, FilterBar, SearchInput, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  DEAL_STATUS_LABELS,
  DEAL_STATUS_TONES,
  DEAL_TYPE_LABELS,
  dealValue,
  episodeSummary,
  formatDate,
  formatMoney,
} from "@/lib/deals";
import type { ContentOwner, DealListItem, DealsSummary, Page } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";

type SortKey = "title" | "owner" | "term_end" | "fee";
type Filters = { q: string; owner: string; status: string; type: string };
const NO_FILTERS: Filters = { q: "", owner: "", status: "", type: "" };

const STATUS_OPTIONS: [string, string][] = [
  ["active", "Active"],
  ["expiring", "Expiring in 90 days"],
  ["upcoming", "Upcoming"],
  ["expired", "Expired"],
  ["draft", "Draft"],
  ["terminated", "Terminated"],
];

function SlotUsage({ used, limit }: { used: number; limit: number }) {
  if (limit === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      <span className="font-semibold">{used}</span>
      <span className="text-muted-foreground"> / {limit}</span>
    </span>
  );
}

export default function DealsPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DealsSummary | null>(null);
  const [owners, setOwners] = useState<ContentOwner[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "term_end", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<DealListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DealsSummary>("/deals/summary").then(setSummary).catch(() => {});
    api<ContentOwner[]>("/content-owners").then(setOwners).catch(() => {});
  }, []);

  // Wait until typing pauses before searching.
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort: sort.key,
      direction: sort.dir,
    });
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.owner) params.set("owner_id", filters.owner);
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("deal_type", filters.type);
    let cancelled = false;
    api<Page<DealListItem>>(`/deals?${params}`)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [filters, sort, page, pageSize]);

  function update(change: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }

  const value = summary?.licence_value.map((v) => formatMoney(v.amount, v.currency)).join(" + ");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Deals"
        description="Content licences: what can be published, until when, and on how many channels."
        actions={
          <Button size="lg" asChild>
            <Link href="/deals/new">
              <Plus />
              New deal
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active deals" value={summary?.active_deals ?? "—"} icon={Handshake} />
        <StatCard label="Licence value (active)" value={value || "—"} icon={IndianRupee} tone="slate" />
        <StatCard
          label="Slots in use"
          value={summary ? `${summary.slots_used} / ${summary.slots_total}` : "—"}
          icon={Tv}
          tone="green"
        />
        <StatCard label="Expiring in 90 days" value={summary?.expiring_soon ?? "—"} icon={AlarmClock} tone="amber" />
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <FilterBar
        active={Boolean(search || filters.owner || filters.status || filters.type)}
        onClear={() => {
          setSearch("");
          update(NO_FILTERS);
        }}
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Search show or owner…" />
        <NativeSelect aria-label="Filter by owner" className="w-44" value={filters.owner} onChange={(e) => update({ owner: e.target.value })}>
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by status" className="w-52" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by type" className="w-44" value={filters.type} onChange={(e) => update({ type: e.target.value })}>
          <option value="">All types</option>
          {Object.entries(DEAL_TYPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Show" sortKey="title" sort={sort} onSort={toggleSort} />
              <SortableHead label="Owner" sortKey="owner" sort={sort} onSort={toggleSort} />
              <SortableHead label="Value" sortKey="fee" sort={sort} onSort={toggleSort} />
              <TableHead>Episodes</TableHead>
              <SortableHead label="Term ends" sortKey="term_end" sort={sort} onSort={toggleSort} />
              <TableHead>YT slots</TableHead>
              <TableHead>FB slots</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((d) => (
              <TableRow key={d.id} className="cursor-pointer" onClick={() => router.push(`/deals/${d.id}`)}>
                <TableCell>
                  <Link href={`/deals/${d.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{DEAL_TYPE_LABELS[d.deal_type]}</p>
                </TableCell>
                <TableCell>{d.owner_name}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{dealValue(d)}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {episodeSummary(d.episode_scope, d.episode_ranges)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(d.term_end)}</TableCell>
                <TableCell>
                  <SlotUsage used={d.yt_slots_used} limit={d.yt_slot_limit} />
                </TableCell>
                <TableCell>
                  <SlotUsage used={d.fb_slots_used} limit={d.fb_slot_limit} />
                </TableCell>
                <TableCell>
                  <Pill tone={DEAL_STATUS_TONES[d.status]}>{DEAL_STATUS_LABELS[d.status]}</Pill>
                </TableCell>
              </TableRow>
            ))}
            {data && data.total === 0 && (
              <EmptyRow colSpan={8}>
                {Object.values(filters).some(Boolean) ? "No deals match these filters." : "No deals yet — create the first one."}
              </EmptyRow>
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
            noun="deals"
          />
        )}
      </div>
    </div>
  );
}
