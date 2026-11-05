import { useSearchParams } from "react-router-dom";

/**
 * List filters kept in the URL, so Back from a detail page returns to the same search, tab and page.
 * Changing anything but the page resets to page 1.
 */
export function useListParams<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""])) as Record<K, string>;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const update = (next: Partial<Record<K | "page", string>>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next) as Array<[string, string | undefined]>) {
      if (value) merged.set(key, value); else merged.delete(key);
    }
    if (!("page" in next)) merged.delete("page");
    setParams(merged, { replace: true });
  };
  const clear = () => setParams({}, { replace: true });
  return { values, page, update, setPage: (p: number) => update({ page: p > 1 ? String(p) : "" } as Partial<Record<K | "page", string>>), clear };
}
