"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Me, Organization } from "@/lib/types";

type SessionValue = {
  me: Me;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    // A 401 here redirects to /login inside api().
    api<Me>("/auth/me").then(setMe).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }, []);

  const switchOrganization = useCallback(async (organizationId: string) => {
    await api<Me>("/auth/switch-organization", {
      method: "POST",
      json: { organization_id: organizationId },
    });
    // Reload so the current page refetches its data for the new company. Admin pages
    // are not company-specific, so picking a company there opens its dashboard.
    if (window.location.pathname.startsWith("/admin")) window.location.assign("/");
    else window.location.reload();
  }, []);

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ me, logout, switchOrganization }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/** The current company, for pages that AppShell only renders when one is selected. */
export function useOrganization(): Organization {
  const { me } = useSession();
  if (!me.organization) throw new Error("No company selected");
  return me.organization;
}
