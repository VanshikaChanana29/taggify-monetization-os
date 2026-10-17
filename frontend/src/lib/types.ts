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
