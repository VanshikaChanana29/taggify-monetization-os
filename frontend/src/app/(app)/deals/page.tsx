"use client";

import { AlarmClock, Handshake, IndianRupee, Plus, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { HELP } from "@/lib/help";
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, DEAL_TYPE_LABELS, dealValue, episodeSummary, formatDate, formatMoney } from "@/lib/deals";
import type { ContentOwner, DealListItem, DealsSummary, Page } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";
import { PageLoader } from "@/components/loader";
import { type FilterField, ListFilters } from "@/components/list-filters";

type SortKey = "title" | "owner" | "term_end" | "fee" | "created";
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

function DealsPage() {
  const urlParams = useSearchParams();
  const router = useRouter();
  const [summary, setSummary] = useState<DealsSummary | null>(null);
  const [owners, setOwners] = useState<ContentOwner[]>([]);
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, status: urlParams.get("status") ?? "" }));
  const [search, setSearch] = useState("");
  // Just added a deal: say so and show it first.
  const added = urlParams.get("added");
  const [sort, setSort] = useState<SortState<SortKey>>(added ? { key: "created", dir: "desc" } : { key: "term_end", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<Page<DealListItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DealsSummary>("/deals/summary")
      .then(setSummary)
      .catch(() => {});
    api<ContentOwner[]>("/content-owners")
      .then(setOwners)
      .catch(() => {});
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

  const filterFields: FilterField[] = [
    { key: "owner", label: "Owner", options: [["", "All owners"], ...owners.map((o): [string, string] => [o.id, o.name])] },
    { key: "status", label: "Status", options: [["", "All statuses"], ...STATUS_OPTIONS] },
    { key: "type", label: "Type", options: [["", "All types"], ...Object.entries(DEAL_TYPE_LABELS)] },
  ];

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
        <StatCard
          label="Active deals"
          value={summary?.active_deals ?? "—"}
          icon={Handshake}
          info={HELP.dealStatus}
          active={filters.status === "active"}
          onClick={() => update({ status: filters.status === "active" ? "" : "active" })}
        />
        <StatCard
          label="Licence value (active)"
          value={value || "—"}
          icon={IndianRupee}
          tone="slate"
          info={HELP.licenceFee}
          onClick={() => update({ status: "active", type: "fixed_fee" })}
        />
        <StatCard
          label="Slots in use"
          value={summary ? `${summary.slots_used} / ${summary.slots_total}` : "—"}
          icon={Tv}
          tone="green"
          info={HELP.slots}
          href="/channels?slot=assigned"
        />
        <StatCard
          label="Expiring in 90 days"
          value={summary?.expiring_soon ?? "—"}
          icon={AlarmClock}
          tone="amber"
          info="Active deals whose licence ends in the next 90 days — decide on renewal before the notice period runs out."
          active={filters.status === "expiring"}
          onClick={() => update({ status: filters.status === "expiring" ? "" : "expiring" })}
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {added && <Notice kind="success">{added} added. It is at the top of the list (newest first).</Notice>}

      <ListFilters
        search={search}
        onSearch={setSearch}
        placeholder="Search show or owner…"
        fields={filterFields}
        values={filters}
        onChange={(key, value) => update({ [key]: value })}
        onClear={() => {
          setSearch("");
          update(NO_FILTERS);
        }}
        total={data?.total}
        noun="deals"
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
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
            {data?.items.map((d, idx) => (
              <TableRow key={d.id} className="cursor-pointer" onClick={() => router.push(`/deals/${d.id}`)}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(page - 1) * pageSize + idx + 1}</TableCell>
                <TableCell>
                  <Link href={`/deals/${d.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{DEAL_TYPE_LABELS[d.deal_type]}</p>
                </TableCell>
                <TableCell>{d.owner_name}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{dealValue(d)}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">{episodeSummary(d.episode_scope, d.episode_ranges)}</TableCell>
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
              <EmptyRow colSpan={9}>
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
            pageSizes={PAGE_SIZES}
            noun="deals"
          />
        )}
      </div>
    </div>
  );
}

export default function DealsPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <DealsPage />
    </Suspense>
  );
}
