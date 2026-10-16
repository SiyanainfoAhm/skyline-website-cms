import { useEffect, useState } from "react";
import { useAdminData } from "@/pages/admin/lib/store";
import { Button, Card, Field, PageHeader, TextArea, TextInput, Toggle, useToast } from "@/pages/admin/components/ui";
import type { FooterConfig } from "@/pages/admin/lib/types";
import { HistoryButton } from "@/pages/admin/components/workflow";
import { footerLinks, studentLinks } from "@/data/site";

export default function FooterPage() {
  const { data, update, logActivity, recordRevision } = useAdminData();
  const { push } = useToast();
  const [draft, setDraft] = useState<FooterConfig>(data.footer);

  // Re-sync with the store once the async CMS load lands (avoids editing seed).
  useEffect(() => {
    setDraft(data.footer);
  }, [data.footer]);

  const set = <K extends keyof FooterConfig>(key: K, value: FooterConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    update((d) => ({ ...d, footer: draft }));
    recordRevision({ entity: "footer", entityId: "footer", title: "Footer", action: "Saved draft", status: "Draft", snapshot: draft });
    logActivity("Updated", "Footer", "Footer");
    push("Footer saved");
  };

  const settings = data.settings;

  return (
    <div>
      <PageHeader
        title="Footer"
        description="The site-wide footer: about text, link column headings, acknowledgement and copyright."
        breadcrumb="Global"
        actions={
          <div className="flex items-center gap-2">
            <HistoryButton entity="footer" entityId="footer" title="Footer" onRestore={(snap) => setDraft(snap as FooterConfig)} />
            <Button icon="ri-save-line" onClick={save}>Save footer</Button>
          </div>
        }
      />

      <Card className="p-5">
        <h2 className="mb-4 font-heading text-base font-semibold text-foreground-950">Footer content</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <Field label="About / intro text">
              <TextArea rows={3} value={draft.about} onChange={(e) => set("about", e.target.value)} />
            </Field>
          </div>
          <Field label="Quick links column title">
            <TextInput value={draft.quickLinksTitle} onChange={(e) => set("quickLinksTitle", e.target.value)} />
          </Field>
          <Field label="Student links column title">
            <TextInput value={draft.studentLinksTitle} onChange={(e) => set("studentLinksTitle", e.target.value)} />
          </Field>
          <div className="lg:col-span-2">
            <Field label="Acknowledgement of Country">
              <TextArea rows={3} value={draft.acknowledgement} onChange={(e) => set("acknowledgement", e.target.value)} />
            </Field>
          </div>
          <Field label="Copyright line">
            <TextInput value={draft.copyright} onChange={(e) => set("copyright", e.target.value)} />
          </Field>
          <div className="flex items-end pb-2">
            <Toggle checked={draft.showAcknowledgement} onChange={(v) => set("showAcknowledgement", v)} label="Show acknowledgement band" />
          </div>
        </div>
      </Card>

      {/* Realistic footer preview */}
      <Card className="mt-5 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-background-200 px-5 py-3">
          <i className="ri-eye-line text-primary-600" aria-hidden="true" />
          <h2 className="font-heading text-sm font-semibold text-foreground-950">Footer preview</h2>
          <span className="ml-auto text-xs text-foreground-500">Live — updates as you type</span>
        </div>

        <div className="bg-background-100">
          {draft.showAcknowledgement ? (
            <div className="site-container flex flex-col items-start gap-4 py-5 md:flex-row md:items-center">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-background-50">
                <i className="ri-building-2-line text-lg" aria-hidden="true" />
              </span>
              <p className="text-xs leading-relaxed text-foreground-600">{draft.acknowledgement}</p>
            </div>
          ) : null}
        </div>

        <div className="bg-accent-950 text-background-100">
          <div className="site-container grid grid-cols-1 gap-8 py-10 sm:grid-cols-2 lg:grid-cols-12">
            <div className="sm:col-span-2 lg:col-span-4">
              {settings.logo ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-background-50/95 px-3 py-2">
                  <img src={settings.logo} alt={settings.name} className="h-9 w-auto max-w-[200px] object-contain" />
                </span>
              ) : (
                <p className="font-heading text-base font-bold text-background-50">{settings.name}</p>
              )}
              <h3 className="mt-5 font-heading text-sm font-semibold text-background-50">About Us</h3>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-background-200">{draft.about}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {settings.social.filter((social) => social.enabled).map((social) => (
                  <span
                    key={social.id}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-background-50/10 text-background-100"
                    title={social.label}
                  >
                    <i className={`${social.icon || "ri-links-line"} text-sm`} aria-hidden="true" />
                  </span>
                ))}
              </div>
              <p className="mt-4 font-label text-sm font-semibold tracking-wide text-background-200">
                RTO {settings.rto} CRICOS {settings.cricos}
              </p>
            </div>

            <div className="lg:col-span-2 lg:col-start-6">
              <h3 className="font-heading text-sm font-semibold text-background-50">{draft.quickLinksTitle}</h3>
              <ul className="mt-3 space-y-2">
                {footerLinks.map((link) => (
                  <li key={link.to} className="text-[13px] text-background-200">{link.label}</li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-2">
              <h3 className="font-heading text-sm font-semibold text-background-50">{draft.studentLinksTitle}</h3>
              <ul className="mt-3 space-y-2">
                {studentLinks.map((link) => (
                  <li key={link.to} className="text-[13px] text-background-200">{link.label}</li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-3">
              <h3 className="font-heading text-sm font-semibold text-background-50">Contact</h3>
              <ul className="mt-3 space-y-2.5 text-[13px] text-background-200">
                <li className="flex items-start gap-2.5">
                  <i className="ri-map-pin-line mt-0.5 text-primary-300" aria-hidden="true" />
                  <span>{settings.address}</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <i className="ri-phone-line text-primary-300" aria-hidden="true" />
                  <span>{settings.phone}</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <i className="ri-mail-line text-primary-300" aria-hidden="true" />
                  <span>{settings.email}</span>
                </li>
              </ul>
              <span className="mt-4 inline-block rounded-md bg-primary-500 px-4 py-2 text-[13px] font-semibold text-background-50">
                Enroll Now
              </span>
            </div>
          </div>

          <div className="border-t border-background-50/10">
            <div className="site-container flex items-center justify-center py-4">
              <p className="text-xs text-background-300">{draft.copyright}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-5 flex justify-end">
        <Button icon="ri-save-line" onClick={save}>
          Save footer
        </Button>
      </div>
    </div>
  );
}