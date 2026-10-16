import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fallbackSiteData, loadPublicSiteData, type PublicSiteData } from "@/lib/publicData";

export type PublicSiteStatus = "loading" | "ready" | "error";
export type PublicSiteSource = "fallback" | "database";

interface PublicSiteContextValue {
  data: PublicSiteData;
  status: PublicSiteStatus;
  /** True only when the current data is backed by real Supabase records. */
  isLive: boolean;
  error: string | null;
  /** Silent background refresh — keeps current content visible while updating. */
  refresh: () => Promise<void>;
  /** Full reload that surfaces the loading state again. */
  reload: () => void;
}

const PublicSiteContext = createContext<PublicSiteContextValue | null>(null);

/**
 * Loads all CMS-managed content from Supabase once on mount and keeps it in
 * context so every public component reads from the same live source.
 *
 * Supabase remains the single source of truth: once a read succeeds, the
 * database result (including an intentionally empty list) replaces the static
 * fallback. The fallback is used only during the very first paint or if the
 * database is unreachable.
 */
export function PublicSiteProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PublicSiteData>(() => fallbackSiteData());
  const [status, setStatus] = useState<PublicSiteStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (silent: boolean) => {
    // A route refresh and the initial load must never fan out into concurrent
    // reads of every CMS table. In particular, React development StrictMode
    // may replay effects while mounting.
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) {
      setStatus("loading");
      setError(null);
    }
    try {
      const next = await loadPublicSiteData();
      setData(next);
      setStatus("ready");
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load website content.";
      if (silent) {
        // Background refresh failed: keep whatever is already on screen.
        return;
      }
      setError(message);
      setStatus("error");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // These must be stable. RouteRefresh depends on `refresh`; recreating it on
  // every successful data update caused the route effect to reload all CMS
  // tables forever.
  const refresh = useCallback(() => load(true), [load]);
  const reload = useCallback(() => {
    void load(false);
  }, [load]);

  // Apply the CMS-managed favicon to the document head at runtime so a favicon
  // change in the CMS shows up on the live site without a redeploy.
  useEffect(() => {
    const href = data.settings.favicon;
    if (!href) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }, [data.settings.favicon]);

  const value = useMemo<PublicSiteContextValue>(
    () => ({
      data,
      status,
      isLive: data.backedByDatabase,
      error,
      refresh,
      reload,
    }),
    [data, status, error, refresh, reload],
  );

  return <PublicSiteContext.Provider value={value}>{children}</PublicSiteContext.Provider>;
}

export function usePublicSite(): PublicSiteContextValue {
  const context = useContext(PublicSiteContext);
  if (!context) {
    throw new Error("usePublicSite must be used within a PublicSiteProvider");
  }
  return context;
}
