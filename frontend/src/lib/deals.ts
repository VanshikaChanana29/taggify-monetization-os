import type {
  DealListItem,
  DealStatus,
  DealType,
  EpisodeRange,
  EpisodeScope,
  OwnerType,
  SlotStatus,
} from "@/lib/types";

export const OWNER_TYPE_LABELS: Record<OwnerType, string> = {
  licensor: "Licensor",
  vendor: "Vendor",
  brand: "Brand / partner",
  owned: "Owned / partner IP",
};

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  fixed_fee: "Fixed fee",
  revenue_share: "Revenue share",
  hybrid: "Minimum guarantee + share",
  partnership: "Partnership (split after CMS fee)",
  owned: "Owned IP",
};

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

export const DEAL_STATUS_TONES: Record<DealStatus, string> = {
  active:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  upcoming:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  draft:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  expired: "border-border bg-muted text-muted-foreground",
  terminated:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400",
};

export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  unassigned: "Unassigned",
  reserved: "Reserved",
  pending_whitelist: "Pending whitelist",
  active: "Active",
  replaced: "Replaced",
};

export const SLOT_STATUS_TONES: Record<SlotStatus, string> = {
  unassigned: "border-border bg-muted text-muted-foreground",
  reserved: DEAL_STATUS_TONES.upcoming,
  pending_whitelist: DEAL_STATUS_TONES.draft,
  active: DEAL_STATUS_TONES.active,
  replaced: DEAL_STATUS_TONES.expired,
};

export const SCOPE_LABELS: Record<EpisodeScope, string> = {
  all: "All episodes",
  ranges: "Episode ranges",
  seasons: "Season + episodes",
};

/** Countries offered in the territory picker (ISO 3166-1 alpha-2). */
export const COUNTRIES: [string, string][] = [
  ["IN", "India"],
  ["NP", "Nepal"],
  ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"],
  ["PK", "Pakistan"],
  ["BT", "Bhutan"],
  ["MV", "Maldives"],
  ["AE", "UAE"],
  ["SA", "Saudi Arabia"],
  ["QA", "Qatar"],
  ["KW", "Kuwait"],
  ["OM", "Oman"],
  ["SG", "Singapore"],
  ["MY", "Malaysia"],
  ["ID", "Indonesia"],
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["ZA", "South Africa"],
  ["KE", "Kenya"],
  ["MU", "Mauritius"],
  ["FJ", "Fiji"],
];

export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(COUNTRIES);

export function formatMoney(amount: string | number | null, currency: string | null): string {
  if (amount === null || !currency) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

/** "₹50,00,000", "40% revenue share", "50% to partner / 50% to us, after CMS fee" or "Owned IP". */
export function dealValue(deal: Pick<DealListItem, "deal_type" | "fee_amount" | "currency" | "revenue_share_pct">): string {
  if (deal.deal_type === "fixed_fee") return formatMoney(deal.fee_amount, deal.currency);
  if (deal.deal_type === "revenue_share") return `${Number(deal.revenue_share_pct)}% revenue share`;
  if (deal.deal_type === "partnership") {
    const pct = Number(deal.revenue_share_pct);
    return `${pct}% to partner / ${100 - pct}% to us, after CMS fee`;
  }
  if (deal.deal_type === "hybrid") {
    return `${formatMoney(deal.fee_amount, deal.currency)} MG + ${Number(deal.revenue_share_pct)}%`;
  }
  return "Owned IP";
}

export function episodeSummary(scope: EpisodeScope, ranges: EpisodeRange[]): string {
  if (scope === "all") return "All episodes";
  return ranges
    .map((r) => {
      const span = r.from_episode === r.to_episode ? `${r.from_episode}` : `${r.from_episode}–${r.to_episode}`;
      return scope === "seasons" ? `S${r.season} E${span}` : span;
    })
    .join(", ");
}

const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Formats a calendar date (YYYY-MM-DD) without timezone shifts. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return shortDate.format(new Date(y, m - 1, d));
}

export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
