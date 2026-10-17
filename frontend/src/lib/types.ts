export type Organization = {
  id: string;
  name: string;
  slug: string;
  base_currency: string;
};

export type User = {
  id: string;
  email: string;
  full_name: string;
  is_superadmin: boolean;
};

export type Me = {
  user: User;
  /** null only for a super admin who is not a member of any company */
  organization: Organization | null;
  organizations: Organization[];
};

export type Member = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
  added_at: string;
};

export type AuditLog = {
  id: string;
  action: string;
  user_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
};

/** One page of a server-paginated list. */
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type AuditActor = { id: string; name: string };

export type AdminOrganization = Organization & {
  active_users: number;
  created_at: string;
};

export type AdminMembership = {
  organization_id: string;
  organization_name: string;
  is_active: boolean;
};

export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  is_superadmin: boolean;
  last_login_at: string | null;
  created_at: string;
  memberships: AdminMembership[];
};

// ---- Part 2: content owners and deals ---------------------------------------------------

export type OwnerType = "licensor" | "vendor" | "owned";
export type DealType = "fixed_fee" | "revenue_share" | "owned";
export type StoredDealStatus = "draft" | "active" | "terminated";
export type DealStatus = StoredDealStatus | "upcoming" | "expired";
export type EpisodeScope = "all" | "ranges" | "seasons";
export type Platform = "youtube" | "facebook";
export type SlotStatus = "unassigned" | "reserved" | "pending_whitelist" | "active" | "replaced";

export type ContentOwner = {
  id: string;
  name: string;
  owner_type: OwnerType;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  is_active: boolean;
  deal_count: number;
  created_at: string;
};

export type EpisodeRange = { season: number | null; from_episode: number; to_episode: number };

export type DealListItem = {
  id: string;
  title: string;
  owner_id: string;
  owner_name: string;
  deal_type: DealType;
  status: DealStatus;
  fee_amount: string | null;
  currency: string | null;
  revenue_share_pct: string | null;
  term_start: string;
  term_end: string;
  episode_scope: EpisodeScope;
  episode_ranges: EpisodeRange[];
  yt_slot_limit: number;
  fb_slot_limit: number;
  yt_slots_used: number;
  fb_slots_used: number;
};

export type Slot = {
  id: string;
  platform: Platform;
  number: number;
  code: string;
  status: SlotStatus;
  notes: string | null;
};

export type Deal = DealListItem & {
  stored_status: StoredDealStatus;
  is_worldwide: boolean;
  territories: string[];
  contract_url: string | null;
  notes: string | null;
  owner_contact_name: string | null;
  owner_contact_email: string | null;
  slots: Slot[];
  created_at: string;
  updated_at: string;
};

export type DealsSummary = {
  active_deals: number;
  expiring_soon: number;
  slots_used: number;
  slots_total: number;
  licence_value: { currency: string; amount: string }[];
};

export type RightsResult = { allowed: boolean; reasons: string[]; checked_on: string };
