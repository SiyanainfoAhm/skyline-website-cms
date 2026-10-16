import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildSeed } from "@/pages/admin/lib/seed";
import { loadAdminData, persistAdminData, emptyAdminData } from "@/pages/admin/lib/db";
import { useAuth } from "@/pages/admin/lib/auth";
import type {
  ActivityItem,
  AdminCourse,
  AdminData,
  AdminForm,
  AdminPage,
  AdminSettings,
  DocItem,
  FooterConfig,
  LinkItem,
  NavMenuItem,
  PublishStatus,
  Revision,
  RevisionEntity,
  SeoEntry,
} from "@/pages/admin/lib/types";

export type StoreStatus = "loading" | "error" | "ready";

interface NewRevision {
  entity: RevisionEntity;
  entityId: string;
  title: string;
  action: string;
  status: PublishStatus;
  snapshot: unknown;
}

interface StoreContextValue {
  data: AdminData;
  status: StoreStatus;
  error: string | null;
  reload: () => void;
  update: (updater: (draft: AdminData) => AdminData) => void;
  /** Applies an update AND persists it immediately, surfacing any DB error. */
  saveNow: (updater: (draft: AdminData) => AdminData) => Promise<void>;
  logActivity: (action: string, item: string, area: string) => void;
  recordRevision: (rev: NewRevision) => void;
  revisionsFor: (entity: RevisionEntity, entityId: string) => Revision[];
  restoreRevision: (id: string) => void;
  resetToSeed: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function now() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const { user, authLoading } = useAuth();
  const [data, setData] = useState<AdminData>(() => buildSeed());
  const [status, setStatus] = useState<StoreStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const syncedRef = useRef<AdminData | null>(null);
  const dataRef = useRef<AdminData>(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const result = await loadAdminData();
      if (result.isEmpty) {
        // First run: push the existing website content into the database.
        syncedRef.current = emptyAdminData();
        setData(buildSeed());
      } else {
        syncedRef.current = result.data;
        setData(result.data);
      }
      loadedRef.current = true;
      setStatus("ready");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load the CMS data.";
      setError(message);
      setStatus("error");
    }
  }, []);

  const reload = useCallback(() => {
    loadedRef.current = false;
    void load();
  }, [load]);

  // Load once the user is authenticated. The CMS is data-driven from Supabase.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      loadedRef.current = false;
      syncedRef.current = null;
      // Do not leave a previous staff member's CMS payload resident after
      // logout or a session-expiry event.
      setData(buildSeed());
      setStatus("ready");
      return;
    }
    void load();
  }, [user, authLoading, load]);

  // Persist changes back to Supabase (debounced), diffing against the last sync.
  useEffect(() => {
    if (!loadedRef.current || !syncedRef.current) return;
    const snapshot = data;
    const timer = window.setTimeout(async () => {
      const previous = syncedRef.current;
      if (!previous) return;
      try {
        await persistAdminData(previous, snapshot);
        syncedRef.current = snapshot;
      } catch (e) {
        console.error("CMS save failed", e);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [data]);

  const update = useCallback((updater: (draft: AdminData) => AdminData) => {
    setData((prev) => updater(prev));
  }, []);

  /**
   * Applies an update and awaits the Supabase write, so callers can show a real
   * success/error result instead of optimistically claiming success. The local
   * form state is never reset by this function — only a resolved promise means
   * the database actually accepted the change.
   */
  const saveNow = useCallback(async (updater: (draft: AdminData) => AdminData) => {
    const previous = syncedRef.current;
    const next = updater(dataRef.current);
    dataRef.current = next;
    setData(next);
    if (!previous) return;
    // If the write throws, syncedRef is left untouched so a retry re-diffs.
    await persistAdminData(previous, next);
    syncedRef.current = next;
  }, []);

  const logActivity = useCallback(
    (action: string, item: string, area: string) => {
      const entry: ActivityItem = {
        id: `act-${Date.now()}`,
        user: user?.name ?? "System",
        action,
        item,
        area,
        at: now(),
      };
      setData((prev) => ({ ...prev, activity: [entry, ...prev.activity].slice(0, 60) }));
    },
    [user],
  );

  const recordRevision = useCallback(
    (rev: NewRevision) => {
      const entry: Revision = {
        id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        by: user?.name ?? "System",
        at: now(),
        ...rev,
      };
      setData((prev) => ({ ...prev, revisions: [entry, ...prev.revisions].slice(0, 200) }));
    },
    [user],
  );

  const revisionsFor = useCallback(
    (entity: RevisionEntity, entityId: string) =>
      data.revisions.filter((r) => r.entity === entity && r.entityId === entityId),
    [data.revisions],
  );

  const restoreRevision = useCallback(
    (id: string) => {
      setData((prev) => {
        const rev = prev.revisions.find((r) => r.id === id);
        if (!rev) return prev;
        const snap = rev.snapshot as never;
        let next: AdminData = prev;
        switch (rev.entity) {
          case "course":
            next = { ...prev, courses: prev.courses.map((c) => (c.id === rev.entityId ? { ...(snap as AdminCourse) } : c)) };
            break;
          case "page":
            next = { ...prev, pages: prev.pages.map((p) => (p.id === rev.entityId ? { ...(snap as AdminPage) } : p)) };
            break;
          case "form":
            next = { ...prev, forms: prev.forms.map((f) => (f.id === rev.entityId ? { ...(snap as AdminForm) } : f)) };
            break;
          case "document":
            next = { ...prev, documents: prev.documents.map((d) => (d.id === rev.entityId ? { ...(snap as DocItem) } : d)) };
            break;
          case "link":
            next = { ...prev, links: prev.links.map((l) => (l.id === rev.entityId ? { ...(snap as LinkItem) } : l)) };
            break;
          case "seo":
            next = { ...prev, seo: prev.seo.map((s) => (s.id === rev.entityId ? { ...(snap as SeoEntry) } : s)) };
            break;
          case "settings":
          case "contact":
            next = { ...prev, settings: { ...(snap as AdminSettings) } };
            break;
          case "navigation":
            next = { ...prev, navigation: snap as NavMenuItem[] };
            break;
          case "footer":
            next = { ...prev, footer: { ...(snap as FooterConfig) } };
            break;
        }
        const restored: Revision = {
          id: `rev-${Date.now()}-restore`,
          entity: rev.entity,
          entityId: rev.entityId,
          title: rev.title,
          action: `Restored from ${rev.at}`,
          status: rev.status,
          by: user?.name ?? "System",
          at: now(),
          snapshot: rev.snapshot,
        };
        const activity: ActivityItem = {
          id: `act-${Date.now()}`,
          user: user?.name ?? "System",
          action: "Restored",
          item: rev.title,
          area: "Versions",
          at: now(),
        };
        return { ...next, revisions: [restored, ...next.revisions].slice(0, 200), activity: [activity, ...next.activity].slice(0, 60) };
      });
    },
    [user],
  );

  const resetToSeed = useCallback(() => {
    loadedRef.current = true;
    if (!syncedRef.current) syncedRef.current = emptyAdminData();
    setData(buildSeed());
  }, []);

  const value = useMemo(
    () => ({ data, status, error, reload, update, saveNow, logActivity, recordRevision, revisionsFor, restoreRevision, resetToSeed }),
    [data, status, error, reload, update, saveNow, logActivity, recordRevision, revisionsFor, restoreRevision, resetToSeed],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAdminData() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useAdminData must be used within AdminStoreProvider");
  return ctx;
}
