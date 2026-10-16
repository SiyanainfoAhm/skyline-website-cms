import { useEffect, useState } from "react";
import { useAdminData } from "@/pages/admin/lib/store";
import { Button, Card, PageHeader, TextInput, Toggle, useToast } from "@/pages/admin/components/ui";
import type { NavMenuItem } from "@/pages/admin/lib/types";
import { HistoryButton } from "@/pages/admin/components/workflow";

export default function NavigationPage() {
  const { data, update, logActivity, recordRevision } = useAdminData();
  const { push } = useToast();
  const [items, setItems] = useState<NavMenuItem[]>(data.navigation);

  // Re-sync with the store once the async CMS load lands (avoids editing seed).
  useEffect(() => {
    setItems(data.navigation);
  }, [data.navigation]);

  const setItem = (i: number, patch: Partial<NavMenuItem>) =>
    setItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));

  const setChild = (i: number, j: number, patch: Partial<NavMenuItem["children"][number]>) =>
    setItems((prev) =>
      prev.map((x, xi) =>
        xi === i ? { ...x, children: x.children.map((c, ci) => (ci === j ? { ...c, ...patch } : c)) } : x,
      ),
    );

  const move = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[i], next[target]] = [next[target], next[i]];
    setItems(next);
  };

  const save = () => {
    update((d) => ({ ...d, navigation: items }));
    recordRevision({ entity: "navigation", entityId: "navigation", title: "Header navigation", action: "Saved draft", status: "Draft", snapshot: items });
    logActivity("Updated", "Header navigation", "Navigation");
    push("Navigation saved");
  };

  return (
    <div>
      <PageHeader
        title="Header & Navigation"
        description="Control the main menu, its order and which items appear. Dropdown items nest under their parent."
        breadcrumb="Global"
        actions={
          <div className="flex items-center gap-2">
            <HistoryButton entity="navigation" entityId="navigation" title="Header navigation" onRestore={(snap) => setItems(snap as NavMenuItem[])} />
            <Button icon="ri-save-line" onClick={save}>Save navigation</Button>
          </div>
        }
      />

      <Card className="p-5">
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={item.id} className="rounded-md border border-background-200 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[28px_1fr_1fr_auto] md:items-center">
                <div className="flex md:flex-col">
                  <button type="button" onClick={() => move(i, -1)} aria-label="Move up" className="flex h-5 w-5 cursor-pointer items-center justify-center text-foreground-400 hover:text-primary-600">
                    <i className="ri-arrow-up-s-fill" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} aria-label="Move down" className="flex h-5 w-5 cursor-pointer items-center justify-center text-foreground-400 hover:text-primary-600">
                    <i className="ri-arrow-down-s-fill" aria-hidden="true" />
                  </button>
                </div>
                <TextInput value={item.label} onChange={(e) => setItem(i, { label: e.target.value })} placeholder="Menu label" />
                <TextInput value={item.to} onChange={(e) => setItem(i, { to: e.target.value })} placeholder="Link (e.g. /about-us)" />
                <div className="flex items-center gap-3">
                  <Toggle checked={item.visible} onChange={(v) => setItem(i, { visible: v })} label="Visible" />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove"
                    onClick={() => setItems((prev) => prev.filter((_, xi) => xi !== i))}
                  >
                    <i className="ri-delete-bin-line" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {item.children.length > 0 ? (
                <div className="mt-3 space-y-2 border-l-2 border-background-200 pl-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-foreground-500">Dropdown items</p>
                  {item.children.map((c, j) => (
                    <div key={c.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <TextInput value={c.label} onChange={(e) => setChild(i, j, { label: e.target.value })} placeholder="Label" />
                      <TextInput value={c.to} onChange={(e) => setChild(i, j, { to: e.target.value })} placeholder="Link" />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Remove"
                        onClick={() => setItem(i, { children: item.children.filter((_, ci) => ci !== j) })}
                      >
                        <i className="ri-delete-bin-line" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setItem(i, { children: [...item.children, { id: `child-${Date.now()}`, label: "", to: "", external: false, visible: true }] })}
                className="mt-3 inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-primary-600 hover:underline"
              >
                <i className="ri-add-line" aria-hidden="true" />
                Add dropdown item
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Button
            variant="outline"
            icon="ri-add-line"
            onClick={() => setItems((prev) => [...prev, { id: `nav-${Date.now()}`, label: "", to: "", visible: true, children: [] }])}
          >
            Add menu item
          </Button>
        </div>
      </Card>

      <div className="mt-5 flex justify-end">
        <Button icon="ri-save-line" onClick={save}>
          Save navigation
        </Button>
      </div>
    </div>
  );
}