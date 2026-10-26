"use client";

import { CirclePlay, FileSpreadsheet, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { ChannelForm } from "@/components/channel-form";
import { ChannelImportDialog } from "@/components/channel-import-dialog";
import { type FilterField, ListFilters } from "@/components/list-filters";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, EmptyRow, SortableHead, TablePagination } from "@/components/data-table";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { YouTubeTokensDialog } from "@/components/youtube-tokens-dialog";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES } from "@/lib/deals";
import { money } from "@/lib/finance";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { ChannelListItem, CmsPartner, DealListItem, DealPartner, Employee, Page, Team } from "@/lib/types";
import type { SortState } from "@/lib/use-client-table";
import { isoDay, shortDate, yesterday, YT_STATUS } from "@/lib/youtube";
import { LoadingOverlay, PageLoader } from "@/components/loader";

type SortKey = "name" | "platform" | "created" | "revenue" | "views" | "rpm" | "change" | "subs";
type Filters = {
  platform: string;
  cms: string;
  partner: string;
  deal: string;
  manager: string;
  team: string;
  youtube: string;
  slot: string;
  status: string;
};
const NO_FILTERS: Filters = {
  platform: "",
  cms: "",
  partner: "",
  deal: "",
  manager: "",
  team: "",
  youtube: "",
  slot: "",
  status: "",
};

type Period = "month" | "last30" | "lastMonth" | "custom";

function range(period: Period): [string, string] {
  const end = new Date(Date.now() - 86_400_000);
  if (period === "last30") return [isoDay(new Date(end.getTime() - 29 * 86_400_000)), isoDay(end)];
  if (period === "lastMonth") {
    return [isoDay(new Date(end.getFullYear(), end.getMonth() - 1, 1)), isoDay(new Date(end.getFullYear(), end.getMonth(), 0))];
  }
  return [isoDay(new Date(end.getFullYear(), end.getMonth(), 1)), isoDay(end)];
}

const compact = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);

function Change({ pct }: { pct: string | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-muted-foreground">—</span>;
  const n = Number(pct);
  const tone = n > 0 ? "text-emerald-600 dark:text-emerald-400" : n < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
  return (
    <span className={`whitespace-nowrap font-semibold tabular-nums ${tone}`}>
      {n > 0 ? "▲" : n < 0 ? "▼" : ""} {Math.abs(n)}%
    </span>
  );
}

const muted = <span className="text-muted-foreground">—</span>;

function ChannelsPage() {
  const urlParams = useSearchParams();
  const router = useRouter();
  const [cmsList, setCmsList] = useState<CmsPartner[]>([]);
  const [deals, setDeals] = useState<DealListItem[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [partners, setPartners] = useState<DealPartner[]>([]);
  const [filters, setFilters] = useState<Filters>(() => ({
    ...NO_FILTERS,
    manager: urlParams.get("managed") === "no" ? "none" : urlParams.get("managed") === "yes" ? "any" : "",
    slot: urlParams.get("slot") ?? "",
    status: urlParams.get("status") ?? "",
    youtube: urlParams.get("youtube") ?? "",
    cms: urlParams.get("cms") ?? "",
    partner: urlParams.get("partner") ?? "",
    team: urlParams.get("team") ?? "",
    deal: urlParams.get("deal") ?? "",
  }));
  // The dashboard opens this list with its period and sort, e.g. ?start=…&end=…&sort=views.
  const urlStart = urlParams.get("start");
  const urlEnd = urlParams.get("end");
  const [period, setPeriod] = useState<Period>(urlStart && urlEnd ? "custom" : "month");
  const [dates, setDates] = useState<[string, string]>(urlStart && urlEnd ? [urlStart, urlEnd] : range("month"));
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>(() => {
    const key = urlParams.get("sort") as SortKey | null;
    const dir = urlParams.get("dir") === "asc" ? "asc" : "desc";
    return key ? { key, dir } : { key: "revenue", dir: "desc" };
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState<Page<ChannelListItem> | null>(null);
  const [creating, setCreating] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<CmsPartner[]>("/cms-partners")
      .then(setCmsList)
      .catch(() => {});
    api<DealPartner[]>("/partners")
      .then(setPartners)
      .catch(() => {});
    api<Page<DealListItem>>("/deals?page_size=100&sort=title")
      .then((p) => setDeals(p.items))
      .catch(() => {});
    api<Employee[]>("/employees")
      .then(setPeople)
      .catch(() => {});
    api<Team[]>("/teams")
      .then(setTeams)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (period !== "custom") setDates(range(period));
  }, [period]);

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
      start: dates[0],
      end: dates[1],
    });
    if (q.trim()) params.set("q", q.trim());
    if (filters.platform) params.set("platform", filters.platform);
    if (filters.cms) params.set("cms_partner_id", filters.cms);
    if (filters.partner) params.set("partner_id", filters.partner);
    if (filters.deal) params.set("deal_id", filters.deal);
    if (filters.team) params.set("team_id", filters.team);
    if (filters.youtube) params.set("youtube", filters.youtube);
    if (filters.manager === "none") params.set("managed", "no");
    else if (filters.manager === "any") params.set("managed", "yes");
    else if (filters.manager) params.set("manager_id", filters.manager);
    if (filters.slot) params.set("slot", filters.slot);
    if (filters.status) params.set("status", filters.status);
    return api<Page<ChannelListItem>>(`/channels?${params}`);
  }, [q, filters, sort, page, pageSize, dates]);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    load()
      .then((r) => !cancelled && setData(r))
      .catch((err: Error) => setError(err.message))
      .finally(() => !cancelled && setFetching(false));
    return () => {
      cancelled = true;
    };
  }, [load, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const update = (change: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  };
  const toggleSort = (key: SortKey) => {
    const numeric = !["name", "platform", "created"].includes(key);
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));
    setPage(1);
  };
  const filterFields: FilterField[] = [
    { group: "People", key: "team", label: "Team", options: [["", "All teams"], ...teams.map((t): [string, string] => [t.id, t.name])] },
    {
      key: "manager",
      label: "Manager",
      options: [["", "All managers"], ["none", "No manager"], ["any", "Has a manager"], ...people.map((p): [string, string] => [p.id, p.full_name])],
    },
    { group: "Business", key: "cms", label: "CMS", options: [["", "All CMS"], ...cmsList.map((c): [string, string] => [c.id, c.name])] },
    ...(partners.length
      ? [
          {
            group: "Business",
            key: "partner",
            label: "Owned by partner",
            options: [["", "Anyone"], ...partners.map((p): [string, string] => [p.id, p.name])] as [string, string][],
          },
        ]
      : []),
    { key: "deal", label: "Deal", options: [["", "All deals"], ...deals.map((d): [string, string] => [d.id, d.title])] },
    {
      key: "slot",
      label: "Deal slot",
      options: [
        ["", "Any"],
        ["assigned", "In a slot"],
        ["unassigned", "No slot"],
      ],
    },
    {
      group: "Channel",
      key: "youtube",
      label: "YouTube data",
      options: [
        ["", "All"],
        ["connected", "Connected"],
        ["expired", "Expired"],
        ["not_connected", "Not connected"],
      ],
    },
    {
      key: "platform",
      label: "Platform",
      options: [
        ["", "All"],
        ["youtube", "YouTube"],
        ["facebook", "Facebook"],
      ],
    },
    {
      key: "status",
      label: "Status",
      options: [
        ["", "All"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ],
    },
  ];
  const anyFilter = Boolean(search) || Object.values(filters).some(Boolean) || period !== "month";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Channels"
        description={`Every channel with its deal, CMS, manager and how it is doing. Numbers for ${shortDate(dates[0])} – ${shortDate(dates[1])}, revenue in USD.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="outline" onClick={() => setImporting(true)}>
              <FileSpreadsheet />
              Import channels
            </Button>
            <Button size="lg" variant="outline" onClick={() => setYoutubeOpen(true)}>
              <CirclePlay />
              YouTube data
            </Button>
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus />
              New channel
            </Button>
          </div>
        }
      />

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        wide
        title="New channel / page"
        description="It appears at the top of the list after you save it."
      >
        {creating && (
          <ChannelForm
            inDialog
            channel={null}
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false);
              setNotice(`${saved.name} added. It is at the top of the list (newest first).`);
              setSearch("");
              update(NO_FILTERS);
              setSort({ key: "created", dir: "desc" });
              refresh();
            }}
          />
        )}
      </Dialog>

      <ChannelImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(added) => {
          setNotice(
            added
              ? `${added} channel${added === 1 ? "" : "s"} added. They are at the top of the list (newest first). Upload the YouTube tokens zip to connect their data.`
              : "No new channels — they were all in the tool already.",
          );
          setSearch("");
          update(NO_FILTERS);
          setSort({ key: "created", dir: "desc" });
          refresh();
        }}
      />

      <YouTubeTokensDialog open={youtubeOpen} onClose={() => setYoutubeOpen(false)} onChanged={refresh} />

      <ListFilters
        search={search}
        onSearch={setSearch}
        placeholder="Search name or channel ID…"
        fields={filterFields}
        values={filters}
        onChange={(key, value) => update({ [key]: value } as Partial<Filters>)}
        onClear={() => {
          setSearch("");
          setPeriod("month");
          update(NO_FILTERS);
        }}
        total={data?.total}
        noun="channels"
      >
        <NativeSelect aria-label="Period" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="month">This month</option>
          <option value="last30">Last 30 days</option>
          <option value="lastMonth">Last month</option>
          <option value="custom">Choose dates</option>
        </NativeSelect>
        {period === "custom" && (
          <>
            <Input
              aria-label="From"
              type="date"
              className="w-40"
              value={dates[0]}
              max={dates[1]}
              onChange={(e) => setDates([e.target.value, dates[1]])}
            />
            <Input
              aria-label="To"
              type="date"
              className="w-40"
              value={dates[1]}
              max={yesterday()}
              onChange={(e) => setDates([dates[0], e.target.value])}
            />
          </>
        )}
      </ListFilters>

      <div className="relative overflow-x-auto rounded-2xl border bg-card shadow-sm">
        <LoadingOverlay show={fetching && data !== null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S.No.</TableHead>
              <SortableHead label="Channel" sortKey="name" sort={sort} onSort={toggleSort} />
              <TableHead>Deal · slot</TableHead>
              <TableHead>Manager · team</TableHead>
              <TableHead>YouTube</TableHead>
              <SortableHead label="Revenue" sortKey="revenue" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHead label="vs before" sortKey="change" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHead label="Views" sortKey="views" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHead label="RPM" sortKey="rpm" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHead label="Subscribers" sortKey="subs" sort={sort} onSort={toggleSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((c, idx) => {
              const m = c.metrics;
              const yt = c.youtube_status ?? "not_connected";
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/channels/${c.id}`)}>
                  <TableCell className="w-14 tabular-nums text-muted-foreground">{(page - 1) * pageSize + idx + 1}</TableCell>
                  <TableCell className="min-w-56">
                    <Link href={`/channels/${c.id}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                      {c.cms_name && <span className="text-xs text-muted-foreground">{c.cms_name}</span>}
                      {c.partner && (
                        <Pill tone="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
                          Partner: {c.partner.name}
                        </Pill>
                      )}
                      {c.status === "inactive" && <Pill tone={DEAL_STATUS_TONES.expired}>Inactive</Pill>}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-44 text-sm">
                    {c.slots.length ? (
                      c.slots.map((s) => (
                        <p key={s.slot_id} className="whitespace-nowrap">
                          {s.deal_title} · <span className="font-mono font-semibold">{s.slot_code}</span>
                        </p>
                      ))
                    ) : (
                      <span className="text-muted-foreground">No slot</span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-32 text-sm">
                    {c.manager?.name ?? <span className="text-muted-foreground">No manager</span>}
                    {c.team && <p className="text-xs text-muted-foreground">{c.team}</p>}
                  </TableCell>
                  <TableCell>{c.platform === "youtube" ? <Pill tone={YT_STATUS[yt].tone}>{YT_STATUS[yt].label}</Pill> : muted}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {m && Number(m.revenue) > 0 ? money(m.revenue, "USD") : muted}
                    {m && Number(m.estimate_share_pct) > 0 && <p className="text-xs font-normal text-muted-foreground">estimate</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Change pct={m?.revenue_change_pct} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m && m.views ? compact(m.views) : muted}</TableCell>
                  <TableCell className="text-right tabular-nums">{m?.rpm ? money(m.rpm, "USD") : muted}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.subscribers !== null && c.subscribers !== undefined ? compact(c.subscribers) : muted}
                    {m?.subscribers_net !== null && m?.subscribers_net !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {m.subscribers_net > 0 ? "+" : ""}
                        {compact(m.subscribers_net)}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {data && data.total === 0 && (
              <EmptyRow colSpan={10}>{anyFilter ? "No channels match these filters." : "No channels yet — add your first one."}</EmptyRow>
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
            noun="channels"
          />
        )}
      </div>
    </div>
  );
}

export default function ChannelsPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ChannelsPage />
    </Suspense>
  );
}
