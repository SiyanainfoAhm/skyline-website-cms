import { supabase } from "@/pages/admin/lib/supabase";
import { publicSiteOrigin } from "@/lib/siteUrl";

/**
 * Which extra ways to sign in Supabase Auth has switched on (Authentication > Providers). The buttons always show; one
 * whose provider is off explains that when pressed, until the owner configures Google, Facebook or SMS.
 */
export interface AuthProviders { google: boolean; facebook: boolean; phone: boolean }

const NONE: AuthProviders = { google: false, facebook: false, phone: false };
let cached: Promise<AuthProviders> | null = null;

export function loadAuthProviders(): Promise<AuthProviders> {
  if (cached) return cached;
  const url = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return Promise.resolve(NONE);
  cached = fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key } })
    .then((response) => (response.ok ? response.json() : null))
    .then((settings: { external?: Record<string, boolean>; disable_signup?: boolean } | null) => {
      const external = settings?.external ?? {};
      return { google: Boolean(external.google), facebook: Boolean(external.facebook), phone: Boolean(external.phone) };
    })
    .catch(() => NONE);
  return cached;
}

/** Where Google / Facebook send the browser back: this deployment's /login, which finishes the sign-in. */
export function oauthReturnUrl(): string {
  const base = __BASE_PATH__.split("/").filter(Boolean).join("/");
  return `${publicSiteOrigin()}${base ? `/${base}` : ""}/login`;
}

export async function signInWithProvider(provider: "google" | "facebook"): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthReturnUrl(), scopes: provider === "facebook" ? "email public_profile" : undefined },
  });
  if (error) throw new Error(`We could not open ${provider === "google" ? "Google" : "Facebook"}. Please try again.`);
}

/** Sends a 6-digit code by SMS. `create` is true only when enrolling; signing in never creates an account. */
export async function sendPhoneCode(e164: string, create: boolean): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: create, channel: "sms" } });
  if (error) {
    if (/rate|too many|seconds/i.test(error.message)) throw new Error("Please wait a minute before asking for another code.");
    if (/signups? not allowed|user not found|not found/i.test(error.message)) throw new Error("No account uses this number. Choose Enroll now to sign up with it.");
    throw new Error("We could not send a code to this number. Check it and try again.");
  }
}

export async function verifyPhoneCode(e164: string, code: string): Promise<string> {
  const { data, error } = await supabase.auth.verifyOtp({ phone: e164, token: code.trim(), type: "sms" });
  if (error || !data.user) throw new Error(/expired/i.test(error?.message ?? "") ? "That code has expired. Ask for a new one." : "That code is not right. Check it and try again.");
  return data.user.id;
}

/** Student or agent: remembered in this tab across the Google / Facebook round trip, so the right details form opens. */
export type SignUpIntent = "student" | "agent";
const INTENT_KEY = "skyline.signup.intent";

export function rememberSignUpIntent(intent: SignUpIntent | null): void {
  try { if (intent) window.sessionStorage.setItem(INTENT_KEY, intent); else window.sessionStorage.removeItem(INTENT_KEY); } catch { /* storage unavailable */ }
}

export function readSignUpIntent(): SignUpIntent {
  try { return window.sessionStorage.getItem(INTENT_KEY) === "agent" ? "agent" : "student"; } catch { return "student"; }
}

/** True when the signed-in account came from Google, Facebook or a phone number (not an emailed invitation). */
export function isSelfSignUpAccount(user: { app_metadata?: Record<string, unknown>; phone?: string | null } | null): boolean {
  if (!user) return false;
  const providers = [user.app_metadata?.provider, ...((user.app_metadata?.providers as unknown[] | undefined) ?? [])].map(String);
  return providers.some((p) => p === "google" || p === "facebook" || p === "phone");
}
