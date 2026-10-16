import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRef } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/pages/admin/lib/supabase";
import { countPortalMetric } from "@/pages/agency/lib/devMetrics";
import { passwordRecoveryUrl } from "@/lib/siteUrl";

/**
 * Agency Portal authentication (Supabase Auth, email + password only).
 *
 * One sign-in page serves all three roles:
 *   - SLIT Admin    — an Active CMS Admin (cms_users.role = 'Admin').
 *   - Agency Admin  — agency_memberships.role = 'agency_admin'.
 *   - Agent         — agency_memberships.role = 'agent'.
 *
 * The authoritative role/scope is resolved server-side by the `portal_identity`
 * SECURITY DEFINER function; the database RLS policies enforce the same scope on
 * every later read/write, so the UI is never the only guard.
 */

export type PortalRole = "slit_admin" | "agency_admin" | "agent";

export interface PortalProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  jobTitle: string;
  status: string;
}

export interface PortalAgency {
  id: string;
  name: string;
  code: string;
  registrationNumber: string;
  businessEmail: string;
  phone: string;
  address: string;
  country: string;
  primaryContact: string;
  status: string;
  isPermanent: boolean;
}

export interface PortalMembership {
  role: "agency_admin" | "agent";
  status: string;
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

interface PortalAuthValue {
  authUser: { id: string; email: string; name: string } | null;
  role: PortalRole | null;
  profile: PortalProfile | null;
  agency: PortalAgency | null;
  membership: PortalMembership | null;
  authLoading: boolean;
  identityLoading: boolean;
  identityError: string;
  signIn: (email: string, password: string) => Promise<ActionResult>;
  signOut: () => Promise<void>;
  requestReset: (email: string) => Promise<ActionResult>;
  reloadIdentity: () => Promise<void>;
  updateOwnProfile: (patch: Partial<Pick<PortalProfile, "fullName" | "phone" | "jobTitle">>) => Promise<ActionResult>;
  changeOwnPassword: (currentPassword: string, password: string) => Promise<ActionResult>;
}

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

function basePathPrefix(): string {
  const base = __BASE_PATH__.split("/").filter(Boolean).join("/");
  return base ? `/${base}` : "";
}

/** Where invite / recovery emails must land (kept unhardcoded for any host). */
export function portalPasswordResetUrl(): string {
  return passwordRecoveryUrl();
}

function mapAuthUser(user: User) {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = String(meta.full_name ?? meta.name ?? "").trim();
  const email = user.email ?? "";
  const fallback = email ? email.split("@")[0] : "User";
  return { id: user.id, email, name: metaName || fallback };
}

function mapProfile(row: Record<string, unknown>): PortalProfile {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    jobTitle: String(row.job_title ?? ""),
    status: String(row.status ?? "Active"),
  };
}

function mapAgency(row: Record<string, unknown>): PortalAgency {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    code: String(row.code ?? ""),
    registrationNumber: String(row.registration_number ?? ""),
    businessEmail: String(row.business_email ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    country: String(row.country ?? ""),
    primaryContact: String(row.primary_contact ?? ""),
    status: String(row.status ?? "Active"),
    isPermanent: Boolean(row.is_permanent),
  };
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [role, setRole] = useState<PortalRole | null>(null);
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [agency, setAgency] = useState<PortalAgency | null>(null);
  const [membership, setMembership] = useState<PortalMembership | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const identityRef = useRef<{ userId: string; at: number; pending: Promise<void> | null }>({ userId: "", at: 0, pending: null });

  const clearIdentity = useCallback(() => {
    setRole(null);
    setProfile(null);
    setAgency(null);
    setMembership(null);
  }, []);

  const resolveIdentity = useCallback(
    async (u: { id: string; email: string; name: string }) => {
      const now = Date.now();
      // The INITIAL_SESSION auth event commonly follows getSession; deduplicate
      // it while still revalidating a live membership at least every two minutes.
      if (identityRef.current.userId === u.id && now - identityRef.current.at < 120_000) {
        if (identityRef.current.pending) return identityRef.current.pending;
        return;
      }
      identityRef.current.userId = u.id;
      identityRef.current.at = now;
      setIdentityLoading(true);
      setIdentityError("");
      const task = (async () => { try {
        countPortalMetric("identity.fetch");
        const { data, error } = await supabase.rpc("portal_identity");
        if (error) throw new Error(error.message);
        const identity = (data ?? {}) as {
          role?: PortalRole | null;
          profile_id?: string | null;
          agency_id?: string | null;
        };
        setRole(identity.role ?? null);

        if (identity.profile_id) {
          const { data: p } = await supabase
            .from("portal_profiles")
            .select("id, full_name, email, phone, job_title, status")
            .eq("id", identity.profile_id)
            .maybeSingle();
          setProfile(p ? mapProfile(p as Record<string, unknown>) : null);
        } else {
          setProfile(null);
        }

        if (identity.agency_id) {
          const { data: a } = await supabase
            .from("agencies")
            .select("id, name, code, registration_number, business_email, phone, address, country, primary_contact, status, is_permanent")
            .eq("id", identity.agency_id)
            .maybeSingle();
          setAgency(a ? mapAgency(a as Record<string, unknown>) : null);

          const { data: m } = await supabase
            .from("agency_memberships")
            .select("role, status")
            .eq("user_id", identity.profile_id ?? "")
            .maybeSingle();
          setMembership(
            m
              ? { role: (m.role === "agency_admin" ? "agency_admin" : "agent"), status: String(m.status ?? "Active") }
              : null,
          );
        } else {
          setAgency(null);
          setMembership(null);
        }
      } catch (e) {
        clearIdentity();
        setIdentityError(e instanceof Error ? e.message : "We could not load your portal access.");
      } finally {
        setIdentityLoading(false);
        identityRef.current.pending = null;
      } })();
      identityRef.current.pending = task;
      return task;
    },
    [clearIdentity],
  );

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        countPortalMetric("auth.getSession");
        if (!active) return;
        const nextUser = data.session?.user ? mapAuthUser(data.session.user) : null;
        setAuthUser(nextUser);
        setAuthLoading(false);
        if (nextUser) void resolveIdentity(nextUser);
      })
      .catch(() => {
        if (active) {
          setAuthLoading(false);
          setIdentityError("We could not verify your session.");
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous — only update local auth state here.
      const nextUser = session?.user ? mapAuthUser(session.user) : null;
      setAuthUser(nextUser);
      if (nextUser) void resolveIdentity(nextUser);
      else clearIdentity();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolveIdentity, clearIdentity]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      return { ok: false, error: error?.message ?? "Incorrect email or password." };
    }
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthUser(null);
    clearIdentity();
  }, [clearIdentity]);

  const requestReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: portalPasswordResetUrl(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const reloadIdentity = useCallback(async () => {
    if (authUser) await resolveIdentity(authUser);
  }, [authUser, resolveIdentity]);

  const updateOwnProfile = useCallback(
    async (patch: Partial<Pick<PortalProfile, "fullName" | "phone" | "jobTitle">>) => {
      if (!authUser) return { ok: false, error: "You are not signed in." };
      const { error } = await supabase
        .from("portal_profiles")
        .update({
          full_name: patch.fullName ?? profile?.fullName ?? authUser.name,
          phone: patch.phone ?? profile?.phone ?? "",
          job_title: patch.jobTitle ?? profile?.jobTitle ?? "",
          updated_at: new Date().toISOString(),
        })
        .eq("auth_user_id", authUser.id);
      if (error) return { ok: false, error: error.message };
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              fullName: patch.fullName ?? prev.fullName,
              phone: patch.phone ?? prev.phone,
              jobTitle: patch.jobTitle ?? prev.jobTitle,
            }
          : prev,
      );
      return { ok: true };
    },
    [authUser, profile],
  );

  // Supabase does not expose a plaintext-password comparison API. Signing in
  // with the current account's email is the supported verification mechanism;
  // it refreshes the same user's session only after the password is valid.
  const changeOwnPassword = useCallback(async (currentPassword: string, password: string) => {
    if (!authUser?.email) return { ok: false, error: "You are not signed in." };
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: authUser.email, password: currentPassword });
    if (verifyError) return { ok: false, error: "Your current password is incorrect." };
    const { error } = await supabase.auth.updateUser({ password });
    return error ? { ok: false, error: error.message } : { ok: true };
  }, [authUser?.email]);

  const value = useMemo<PortalAuthValue>(
    () => ({
      authUser,
      role,
      profile,
      agency,
      membership,
      authLoading,
      identityLoading,
      identityError,
      signIn,
      signOut,
      requestReset,
      reloadIdentity,
      updateOwnProfile,
      changeOwnPassword,
    }),
    [
      authUser,
      role,
      profile,
      agency,
      membership,
      authLoading,
      identityLoading,
      identityError,
      signIn,
      signOut,
      requestReset,
      reloadIdentity,
      updateOwnProfile,
      changeOwnPassword,
    ],
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth(): PortalAuthValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error("usePortalAuth must be used within PortalAuthProvider");
  return ctx;
}
