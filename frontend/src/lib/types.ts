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
  channel_id: string | null;
  channel_name: string | null;
  channel_external_id: string | null;
  cms_name: string | null;
  manager_name: string | null;
  since: string | null;
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

// ---- Part 3: CMS partners, channels and people -------------------------------------------

export type PersonRef = { id: string; name: string };

export type CmsPartner = {
  id: string;
  name: string;
  platform: Platform;
  notes: string | null;
  is_active: boolean;
  channel_count: number;
  created_at: string;
};

export type ChannelSlotRef = {
  deal_id: string;
  deal_title: string;
  owner_name: string;
  slot_id: string;
  slot_code: string;
  slot_status: SlotStatus;
  since: string;
};

export type ChannelListItem = {
  id: string;
  platform: Platform;
  name: string;
  external_id: string;
  url: string | null;
  status: "active" | "inactive";
  cms_partner_id: string | null;
  cms_name: string | null;
  slots: ChannelSlotRef[];
  manager: PersonRef | null;
  team_lead: PersonRef | null;
  created_at: string;
};

export type SlotHistoryItem = {
  id: string;
  deal_id: string;
  deal_title: string;
  slot_id: string;
  slot_code: string;
  channel_id: string;
  channel_name: string;
  start_date: string;
  end_date: string | null;
  start_reason: "assigned" | "replacement";
  end_reason: "replaced" | "unassigned" | null;
  notes: string | null;
};

export type ManagerHistoryItem = {
  id: string;
  channel_id: string;
  channel_name: string;
  employee: PersonRef;
  start_date: string;
  end_date: string | null;
};

export type ChannelDetail = ChannelListItem & {
  notes: string | null;
  slot_history: SlotHistoryItem[];
  manager_history: ManagerHistoryItem[];
};

export type ChannelsSummary = {
  active_channels: number;
  in_slots: number;
  without_slot: number;
  without_manager: number;
};

export type Role = {
  id: string;
  name: string;
  can_manage_youtube: boolean;
  can_manage_facebook: boolean;
  can_lead_team: boolean;
};

export type RoleWithCount = Role & { people_count: number };

export type TeamRef = { id: string; name: string };

export type Team = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  lead: PersonRef | null;
  lead_since: string | null;
  member_count: number;
  channel_count: number;
  created_at: string;
};

export type TeamHistoryItem = { id: string; person: PersonRef; start_date: string; end_date: string | null };

export type TeamDetail = Team & {
  members: PersonRef[];
  lead_history: TeamHistoryItem[];
  member_history: TeamHistoryItem[];
};

export type Employee = {
  id: string;
  full_name: string;
  role: Role;
  team: TeamRef | null;
  team_lead: PersonRef | null;
  leads_teams: TeamRef[];
  email: string | null;
  phone: string | null;
  join_date: string | null;
  monthly_salary: string | null;
  salary_currency: string;
  is_active: boolean;
  notes: string | null;
  channel_count: number;
  created_at: string;
};

export type EmployeeDetail = Employee & {
  channels: { channel_id: string; channel_name: string; platform: Platform; since: string; deals: string[] }[];
  team_members: PersonRef[];
  history: ManagerHistoryItem[];
  team_history: { id: string; team: TeamRef; start_date: string; end_date: string | null }[];
};

// ---- Part 4A: revenue, FX, CMS settlement --------------------------------------------------

export type RevenueImport = {
  id: string;
  file_name: string;
  uploaded_by: string | null;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_failed: number;
  errors: { line: number; message: string }[];
  created_at: string;
};

export type RevenueFact = {
  id: string;
  day: string;
  channel_id: string;
  channel_name: string;
  platform: Platform;
  cms_name: string | null;
  gross_amount: string;
  currency: string;
  views: number | null;
  state: "provisional" | "final";
  source: string;
};

export type FxRate = { id: string; month: string; currency: string; rate: string };

export type Tier = { from_amount: string; rate_pct: string };

export type FeeSchedule = {
  id: string;
  effective_from: string;
  tier_type: "whole" | "marginal";
  currency: string;
  tiers: Tier[];
  notes: string | null;
};

export type CmsMonth = {
  cms_id: string | null;
  cms_name: string;
  currency: string | null;
  gross: string;
  fee: string | null;
  net: string | null;
  fee_rule: string | null;
  fx_rate: string | null;
  gross_base: string | null;
  fee_base: string | null;
  net_base: string | null;
  statement_net: string | null;
  variance: string | null;
  adjustments: string;
  received: string;
  outstanding: string | null;
  channel_count: number;
  warnings: string[];
};

export type FinanceMonth = {
  month: string;
  base_currency: string;
  gross: string;
  fee: string;
  net_receivable: string;
  received: string;
  outstanding: string;
  incomplete: boolean;
  rows: CmsMonth[];
};

export type CmsMonthDetail = {
  month: string;
  base_currency: string;
  summary: CmsMonth;
  channels: {
    channel_id: string;
    channel_name: string;
    platform: Platform;
    deals: string[];
    gross: string;
    fee_share: string | null;
    net_share: string | null;
    views: number | null;
  }[];
  statement: {
    id: string;
    currency: string;
    gross_amount: string;
    fee_amount: string;
    net_amount: string;
    reference: string | null;
    notes: string | null;
  } | null;
  receipts: { id: string; received_on: string; amount: string; reference: string | null; notes: string | null }[];
  adjustments: { id: string; amount: string; reason: string; created_at: string }[];
};
