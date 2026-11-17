"use client";

import { AlarmClock, ChevronDown, ChevronRight, Handshake, IndianRupee, Plus, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr } from "@/lib/finance";
import { HELP } from "@/lib/help";
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, DEAL_TYPE_LABELS, dealValue, episodeSummary, formatDate, formatMoney } from "@/lib/deals";
import type { ContentOwner, DealListItem, DealsSummary, Page, ParentDealListItem } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";
import { PageLoader } from "@/components/loader";
import { type FilterField, ListFilters } from "@/components/list-filters";

type SortKey = "name" | "term_end" | "amount" | "created";
type Filters = { q: string; owner: string; status: string; type: string };
const NO_FILTERS: Filters = { q: "", owner: "", status: "", type: "" };

const STATUS_OPTIONS: [string, string][] = [
  ["active", "Active"],
  ["expiring", "Expiring in 90 days"],
  ["upcoming", "Upcoming"],
  ["expired", "Expired"],
];

function Profit({ profit, recovery }: { profit: string | null | undefined; recovery?: string | null }) {
  if (profit == null) return <>—</>;
  const n = Number(profit);
  return (
    <>
      <span className={n >= 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-red-700 dark:text-red-400"}>
        {n >= 0 ? "+" : "−"}
        {compactInr(String(Math.abs(n)))}
      </span>
      {recovery != null && <span className="block text-xs text-muted-foreground">{Math.round(Number(recovery))}% covered</span>}
    </>
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
  const [data, setData] = useState<Page<ParentDealListItem> | null>(null);
  /** Shows of the deals opened in the list, by deal id (null while loading). */
  const [open, setOpen] = useState<Record<string, DealListItem[] | null>>({});
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
    api<Page<ParentDealListItem>>(`/parent-deals?${params}`)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [filters, sort, page, pageSize]);

  function toggle(id: string) {
    if (id in open) {
      setOpen((o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id)));
      return;
    }
    setOpen((o) => ({ ...o, [id]: null }));
    api<Page<DealListItem>>(`/deals?parent_id=${id}&page_size=100&sort=title`)
      .then((p) => setOpen((o) => (id in o ? { ...o, [id]: p.items } : o)))
      .catch((err: Error) => setError(err.message));
  }

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
        description="Each deal is one contract with a content owner; open it to see its shows."
        actions={
          <Button size="lg" asChild>
            <Link href="/parent-deals/new">
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
          info="Active deals whose term ends in the next 90 days — decide on renewal before the notice period runs out."
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {added && <Notice kind="success">{added} added. It is at the top of the list (newest first).</Notice>}

      <ListFilters
        search={search}
        onSearch={setSearch}
        placeholder="Search deal, show or owner…"
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
              <TableHead className="w-10" />
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="Deal" sortKey="name" sort={sort} onSort={toggleSort} />
              <TableHead>Owner</TableHead>
              <SortableHead label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} />
              <TableHead>Given to shows</TableHead>
              <TableHead>Shows</TableHead>
              <SortableHead label="Term ends" sortKey="term_end" sort={sort} onSort={toggleSort} />
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Profit / loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((p, idx) => {
              const pays = p.deal_type === "fixed_fee" || p.deal_type === "hybrid";
              const isOpen = p.id in open;
              const shows = open[p.id];
              return (
                <Fragment key={p.id}>
                  <TableRow className="cursor-pointer" onClick={() => router.push(`/parent-deals/${p.id}`)}>
                    <TableCell className="w-10">
                      {p.show_count > 0 && (
                        <button
                          type="button"
                          aria-label={isOpen ? "Hide shows" : "Show shows"}
                          className="rounded-md p-1 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(p.id);
                          }}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="w-14 tabular-nums text-muted-foreground">{(page - 1) * pageSize + idx + 1}</TableCell>
                    <TableCell>
                      <Link href={`/parent-deals/${p.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{DEAL_TYPE_LABELS[p.deal_type]}</p>
                    </TableCell>
                    <TableCell>{p.owner_name}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{pays ? formatMoney(p.amount, p.currency) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {pays ? (
                        <>
                          {formatMoney(p.allotted, p.currency)}
                          <span className="block text-xs text-muted-foreground">{formatMoney(p.unallotted, p.currency)} left</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{p.show_count}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(p.term_end)}</TableCell>
                    <TableCell>
                      <Pill tone={DEAL_STATUS_TONES[p.status]}>{DEAL_STATUS_LABELS[p.status]}</Pill>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Profit profit={p.profit} recovery={p.recovery_pct} />
                    </TableCell>
                  </TableRow>
                  {isOpen && shows === null && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-muted/30 pl-16 text-sm text-muted-foreground">
                        Loading shows…
                      </TableCell>
                    </TableRow>
                  )}
                  {shows?.map((d) => (
                    <TableRow key={d.id} className="cursor-pointer bg-muted/30" onClick={() => router.push(`/deals/${d.id}`)}>
                      <TableCell />
                      <TableCell />
                      <TableCell colSpan={2} className="pl-6">
                        <Link href={`/deals/${d.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                          ↳ {d.title}
                        </Link>
                        <p className="max-w-64 truncate text-xs text-muted-foreground">{episodeSummary(d.episode_scope, d.episode_ranges)}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{dealValue(d)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        YT {d.yt_slots_used}/{d.yt_slot_limit} · FB {d.fb_slots_used}/{d.fb_slot_limit}
                      </TableCell>
                      <TableCell />
                      <TableCell className="whitespace-nowrap">{formatDate(d.term_end)}</TableCell>
                      <TableCell>
                        <Pill tone={DEAL_STATUS_TONES[d.status]}>{DEAL_STATUS_LABELS[d.status]}</Pill>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Profit profit={d.profit} recovery={d.recovery_pct} />
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
            {data && data.total === 0 && (
              <EmptyRow colSpan={10}>
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
