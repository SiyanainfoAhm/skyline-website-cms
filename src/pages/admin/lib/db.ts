import { supabase } from "@/pages/admin/lib/supabase";
import { buildSeed } from "@/pages/admin/lib/seed";
import { socialIconFor } from "@/lib/socialPlatforms";
import type {
  AdminCourse,
  AdminData,
  AdminForm,
  AdminFormField,
  AdminPage,
  AdminSettings,
  AdminUser,
  DocItem,
  FooterConfig,
  NavMenuItem,
  Revision,
  SeoEntry,
} from "@/pages/admin/lib/types";

/* ------------------------------------------------------------------ Helpers */

type Row = Record<string, any>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const bool = (v: unknown): boolean => Boolean(v);

function fmtTs(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

async function fetchRows(table: string): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Row[];
}

/* --------------------------------------------------------- Model -> DB rows */

function settingsRow(s: AdminSettings): Row {
  return {
    id: 1,
    name: s.name,
    short_name: s.shortName,
    logo: s.logo,
    favicon: s.favicon,
    phone: s.phone,
    email: s.email,
    admissions_email: s.admissionsEmail,
    address: s.address,
    rto: s.rto,
    cricos: s.cricos,
    sign_in_url: s.signInUrl,
    home_hero_images: s.homeHeroImages,
    home_about_image: s.homeAboutImage,
  };
}

function footerRow(f: FooterConfig): Row {
  return {
    id: 1,
    about: f.about,
    quick_links_title: f.quickLinksTitle,
    student_links_title: f.studentLinksTitle,
    acknowledgement: f.acknowledgement,
    copyright: f.copyright,
    show_acknowledgement: f.showAcknowledgement,
  };
}

function tableSets(d: AdminData): Record<string, Row[]> {
  return {
    cms_settings: [settingsRow(d.settings)],
    cms_social_links: d.settings.social.map((s, i) => ({
      id: s.id,
      settings_id: 1,
      label: s.label,
      href: s.href,
      icon: s.icon,
      visible: s.enabled,
      sort: i,
    })),
    cms_courses: d.courses.map((c) => ({
      id: c.id,
      slug: c.slug,
      code: c.code,
      cricos: c.cricos,
      name: c.name,
      category: c.category,
      training_package: c.trainingPackage,
      duration: c.duration,
      mode: c.mode,
      short_description: c.shortDescription,
      full_description: c.fullDescription,
      entry_requirements: c.entryRequirements,
      career: c.career,
      fees: c.fees,
      image: c.image,
      status: c.status,
      display_order: c.displayOrder,
      featured: c.featured,
      updated_at: c.updatedAt || undefined,
      updated_by: c.updatedBy || null,
    })),
    cms_course_sections: d.courses.flatMap((c) =>
      c.sections.map((s, i) => ({ id: s.id, course_id: c.id, title: s.title, body: s.body, sort: i })),
    ),
    cms_course_units: d.courses.flatMap((c) =>
      c.units.map((u, i) => ({
        id: u.id,
        course_id: c.id,
        code: u.code,
        name: u.name,
        category: u.category,
        sort: i,
      })),
    ),
    cms_course_attachments: d.courses.flatMap((c) =>
      c.attachments.map((a, i) => ({ id: a.id, course_id: c.id, name: a.name, url: a.url, original_file_name: a.originalFileName ?? null, storage_file_name: a.storageFileName ?? null, bucket_name: a.bucketName ?? null, storage_path: a.storagePath ?? null, mime_type: a.mimeType ?? null, file_size: a.fileSize ?? null, sort: i })),
    ),
    cms_course_links: d.courses.flatMap((c) =>
      c.links.map((l, i) => ({
        id: l.id,
        course_id: c.id,
        label: l.label,
        url: l.url,
        external: l.external,
        sort: i,
      })),
    ),
    cms_pages: d.pages.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      title: p.title,
      body: p.body,
      in_nav: p.inNav,
      seo_title: p.seoTitle,
      seo_description: p.seoDescription,
      status: p.status,
      updated_at: p.updatedAt || undefined,
      updated_by: p.updatedBy || null,
    })),
    cms_forms: d.forms.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      status: f.status,
      updated_at: f.updatedAt || undefined,
    })),
    cms_form_fields: d.forms.flatMap((f) =>
      f.fields.map((field, i) => ({
        id: field.id,
        form_id: f.id,
        label: field.label,
        type: field.type,
        required: field.required,
        help: field.help,
        options: field.options,
        config: {
          placeholder: field.placeholder ?? "",
          defaultValue: field.defaultValue ?? "",
          maxLength: field.maxLength ?? null,
          min: field.min ?? "",
          max: field.max ?? "",
          step: field.step ?? "",
          fileTypes: field.fileTypes ?? "",
          maxSizeMb: field.maxSizeMb ?? null,
          rows: field.rows ?? null,
        },
        visible: field.visible,
        sort: i,
      })),
    ),
    cms_documents: d.documents.map((doc, i) => ({
      id: doc.id,
      name: doc.name,
      category: doc.category,
      description: doc.description,
      file_name: doc.fileName,
      url: doc.url,
      size_label: doc.sizeLabel,
      docs_count: doc.docsCount,
      status: doc.status,
      display_order: doc.displayOrder || i + 1,
      original_file_name: doc.originalFileName ?? null,
      storage_file_name: doc.storageFileName ?? null,
      bucket_name: doc.bucketName ?? null,
      storage_path: doc.storagePath ?? null,
      mime_type: doc.mimeType ?? null,
      file_size: doc.fileSize ?? null,
      assistant_publication_approved: doc.assistantPublicationApproved ?? false,
    })),
    cms_navigation_items: d.navigation.flatMap((item, i) => {
      const parent: Row = {
        id: item.id,
        parent_id: null,
        label: item.label,
        to_path: item.to,
        external: false,
        visible: item.visible,
        sort: i,
      };
      const children = item.children.map((c, j) => ({
        id: c.id,
        parent_id: item.id,
        label: c.label,
        to_path: c.to,
        external: c.external,
        visible: c.visible,
        sort: j,
      }));
      return [parent, ...children];
    }),
    cms_footer: [footerRow(d.footer)],
    cms_seo: d.seo.map((s) => ({
      id: s.id,
      page: s.page,
      path: s.path,
      title: s.title,
      description: s.description,
      keywords: s.keywords,
    })),
    cms_users: d.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      last_login: u.lastLogin,
    })),
    cms_activity_log: d.activity.map((a) => ({
      id: a.id,
      user: a.user,
      action: a.action,
      item: a.item,
      area: a.area,
      at: a.at || undefined,
    })),
    cms_revisions: d.revisions.map((r) => ({
      id: r.id,
      entity: r.entity,
      entity_id: r.entityId,
      title: r.title,
      action: r.action,
      status: r.status,
      by: r.by,
      at: r.at || undefined,
      snapshot: r.snapshot ?? null,
    })),
  };
}

const TABLE_ORDER = [
  "cms_settings",
  "cms_social_links",
  "cms_courses",
  "cms_course_sections",
  "cms_course_units",
  "cms_course_attachments",
  "cms_course_links",
  "cms_pages",
  "cms_forms",
  "cms_form_fields",
  "cms_documents",
  "cms_navigation_items",
  "cms_footer",
  "cms_seo",
  "cms_users",
  "cms_activity_log",
  "cms_revisions",
];

/* --------------------------------------------------------- DB rows -> Model */

function courseFromRow(r: Row, sections: Row[], units: Row[], attachments: Row[], links: Row[]): AdminCourse {
  return {
    id: str(r.id),
    slug: str(r.slug),
    code: str(r.code),
    cricos: str(r.cricos),
    name: str(r.name),
    category: str(r.category),
    trainingPackage: str(r.training_package),
    duration: str(r.duration),
    mode: str(r.mode),
    shortDescription: str(r.short_description),
    fullDescription: str(r.full_description),
    entryRequirements: str(r.entry_requirements),
    career: str(r.career),
    fees: str(r.fees),
    image: str(r.image),
    attachments: attachments.map((a) => ({ id: str(a.id), name: str(a.name), url: str(a.url), originalFileName: str(a.original_file_name), storageFileName: str(a.storage_file_name), bucketName: str(a.bucket_name), storagePath: str(a.storage_path), mimeType: str(a.mime_type), fileSize: Number(a.file_size ?? 0) || undefined })),
    links: links.map((l) => ({ id: str(l.id), label: str(l.label), url: str(l.url), external: bool(l.external) })),
    sections: sections.map((s) => ({ id: str(s.id), title: str(s.title), body: str(s.body) })),
    units: units.map((u) => ({ id: str(u.id), code: str(u.code), name: str(u.name), category: str(u.category) || "Core" })),
    status: (r.status === "Published" ? "Published" : "Draft") as AdminCourse["status"],
    displayOrder: Number(r.display_order ?? 0),
    featured: bool(r.featured),
    updatedAt: fmtTs(r.updated_at),
    updatedBy: str(r.updated_by),
  };
}

function fieldConfigFrom(config: unknown): {
  placeholder: string;
  defaultValue: string;
  maxLength?: number;
  min: string;
  max: string;
  step: string;
  fileTypes: string;
  maxSizeMb?: number;
  rows?: number;
} {
  const c = config && typeof config === "object" ? (config as Row) : {};
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    placeholder: str(c.placeholder),
    defaultValue: str(c.defaultValue),
    maxLength: num(c.maxLength),
    min: str(c.min),
    max: str(c.max),
    step: str(c.step),
    fileTypes: str(c.fileTypes),
    maxSizeMb: num(c.maxSizeMb),
    rows: num(c.rows),
  };
}

function pageFromRow(r: Row): AdminPage {
  return {
    id: str(r.id),
    name: str(r.name),
    slug: str(r.slug),
    title: str(r.title),
    body: str(r.body),
    inNav: bool(r.in_nav),
    seoTitle: str(r.seo_title),
    seoDescription: str(r.seo_description),
    status: (r.status === "Published" ? "Published" : "Draft") as AdminPage["status"],
    updatedAt: fmtTs(r.updated_at),
    updatedBy: str(r.updated_by),
  };
}

function formFromRow(r: Row, fields: Row[]): AdminForm {
  return {
    id: str(r.id),
    name: str(r.name),
    description: str(r.description),
    status: (r.status === "Published" ? "Published" : "Draft") as AdminForm["status"],
    updatedAt: fmtTs(r.updated_at),
    fields: fields.map(
      (f): AdminFormField => ({
        id: str(f.id),
        label: str(f.label),
        type: str(f.type) as AdminFormField["type"],
        required: bool(f.required),
        help: str(f.help),
        options: Array.isArray(f.options) ? (f.options as string[]) : [],
        visible: f.visible === undefined ? true : bool(f.visible),
        ...fieldConfigFrom(f.config),
      }),
    ),
  };
}

function documentsFromRows(rows: Row[]): DocItem[] {
  return rows.map((d) => ({
    id: str(d.id),
    name: str(d.name),
    category: str(d.category),
    description: str(d.description),
    fileName: str(d.file_name),
    url: str(d.url),
    sizeLabel: str(d.size_label),
    docsCount: Number(d.docs_count ?? 1),
    status: (d.status === "Published" ? "Published" : "Draft") as DocItem["status"],
    displayOrder: Number(d.display_order ?? 0),
    originalFileName: str(d.original_file_name), storageFileName: str(d.storage_file_name), bucketName: str(d.bucket_name), storagePath: str(d.storage_path), mimeType: str(d.mime_type), fileSize: Number(d.file_size ?? 0) || undefined, assistantPublicationApproved: bool(d.assistant_publication_approved),
  }));
}

function navigationFromRows(rows: Row[]): NavMenuItem[] {
  const parents = rows.filter((r) => !r.parent_id).sort((a, b) => Number(a.sort) - Number(b.sort));
  return parents.map((p) => ({
    id: str(p.id),
    label: str(p.label),
    to: str(p.to_path),
    visible: p.visible === undefined ? true : bool(p.visible),
    children: rows
      .filter((r) => r.parent_id === p.id)
      .sort((a, b) => Number(a.sort) - Number(b.sort))
      .map((c) => ({
        id: str(c.id),
        label: str(c.label),
        to: str(c.to_path),
        external: bool(c.external),
        visible: c.visible === undefined ? true : bool(c.visible),
      })),
  }));
}

/* ------------------------------------------------------------------ Loading */

export interface LoadResult {
  data: AdminData;
  isEmpty: boolean;
}

export async function loadAdminData(): Promise<LoadResult> {
  const [
    settingsRows,
    socialRows,
    usersRows,
    coursesRows,
    sectionsRows,
    unitsRows,
    attachmentsRows,
    linksRows,
    pagesRows,
    formsRows,
    fieldsRows,
    documentsRows,
    navRows,
    footerRows,
    seoRows,
    activityRows,
    revisionRows,
  ] = await Promise.all([
    fetchRows("cms_settings"),
    fetchRows("cms_social_links"),
    fetchRows("cms_users"),
    fetchRows("cms_courses"),
    fetchRows("cms_course_sections"),
    fetchRows("cms_course_units"),
    fetchRows("cms_course_attachments"),
    fetchRows("cms_course_links"),
    fetchRows("cms_pages"),
    fetchRows("cms_forms"),
    fetchRows("cms_form_fields"),
    fetchRows("cms_documents"),
    fetchRows("cms_navigation_items"),
    fetchRows("cms_footer"),
    fetchRows("cms_seo"),
    fetchRows("cms_activity_log"),
    fetchRows("cms_revisions"),
  ]);

  const seed = buildSeed();
  const settingsRow = settingsRows[0];
  const social = socialRows
    .sort((a, b) => Number(a.sort) - Number(b.sort))
    .map((s) => ({
      id: str(s.id),
      label: str(s.label),
      href: str(s.href),
      icon: str(s.icon) || socialIconFor(str(s.label)),
      enabled: s.visible === undefined ? true : bool(s.visible),
    }));

  const settings: AdminSettings = settingsRow
    ? {
        name: str(settingsRow.name),
        shortName: str(settingsRow.short_name),
        logo: str(settingsRow.logo),
        favicon: str(settingsRow.favicon),
        phone: str(settingsRow.phone),
        email: str(settingsRow.email),
        admissionsEmail: str(settingsRow.admissions_email),
        address: str(settingsRow.address),
        rto: str(settingsRow.rto),
        cricos: str(settingsRow.cricos),
        signInUrl: str(settingsRow.sign_in_url),
        homeHeroImages: Array.isArray(settingsRow.home_hero_images)
          ? (settingsRow.home_hero_images as unknown[]).map((v) => str(v)).filter(Boolean)
          : seed.settings.homeHeroImages,
        homeAboutImage: str(settingsRow.home_about_image) || seed.settings.homeAboutImage,
        social: social.length ? social : seed.settings.social,
      }
    : { ...seed.settings, social: social.length ? social : seed.settings.social };

  const footerRowVal = footerRows[0];
  const footer: FooterConfig = footerRowVal
    ? {
        about: str(footerRowVal.about),
        quickLinksTitle: str(footerRowVal.quick_links_title),
        studentLinksTitle: str(footerRowVal.student_links_title),
        acknowledgement: str(footerRowVal.acknowledgement),
        copyright: str(footerRowVal.copyright),
        showAcknowledgement: bool(footerRowVal.show_acknowledgement),
      }
    : seed.footer;

  const courses = coursesRows
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map((r) =>
      courseFromRow(
        r,
        sectionsRows.filter((s) => s.course_id === r.id).sort((a, b) => Number(a.sort) - Number(b.sort)),
        unitsRows.filter((u) => u.course_id === r.id).sort((a, b) => Number(a.sort) - Number(b.sort)),
        attachmentsRows.filter((a) => a.course_id === r.id).sort((a, b) => Number(a.sort) - Number(b.sort)),
        linksRows.filter((l) => l.course_id === r.id).sort((a, b) => Number(a.sort) - Number(b.sort)),
      ),
    );

  const pages = pagesRows.map(pageFromRow);
  const forms = formsRows.map((r) =>
    formFromRow(r, fieldsRows.filter((f) => f.form_id === r.id).sort((a, b) => Number(a.sort) - Number(b.sort))),
  );
  const documents = documentsFromRows(documentsRows);
  const navigation = navigationFromRows(navRows);
  const seo: SeoEntry[] = seoRows.map((s) => ({
    id: str(s.id),
    page: str(s.page),
    path: str(s.path),
    title: str(s.title),
    description: str(s.description),
    keywords: str(s.keywords),
  }));
  const users: AdminUser[] = usersRows.map((u) => ({
    id: str(u.id),
    name: str(u.name),
    email: str(u.email),
    role: str(u.role) === "Admin" ? "Admin" : "Editor",
    status: str(u.status) === "Inactive" ? "Inactive" : "Active",
    lastLogin: str(u.last_login),
  }));
  const activity = activityRows
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((a) => ({
      id: str(a.id),
      user: str(a.user),
      action: str(a.action),
      item: str(a.item),
      area: str(a.area),
      at: fmtTs(a.at),
    }));
  const revisions: Revision[] = revisionRows
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((r) => ({
      id: str(r.id),
      entity: str(r.entity) as Revision["entity"],
      entityId: str(r.entity_id),
      title: str(r.title),
      action: str(r.action),
      status: (r.status === "Published" ? "Published" : "Draft") as Revision["status"],
      by: str(r.by),
      at: fmtTs(r.at),
      snapshot: r.snapshot,
    }));

  const isEmpty = courses.length === 0 && pages.length === 0 && forms.length === 0;

  return {
    data: {
      settings,
      courses,
      pages,
      navigation: navigation.length ? navigation : seed.navigation,
      footer,
      forms,
      media: seed.media,
      documents,
      links: seed.links,
      seo,
      users: users.length ? users : seed.users,
      activity,
      revisions,
    },
    isEmpty,
  };
}

/* -------------------------------------------------------------- Persisting */

export function emptyAdminData(): AdminData {
  const seed = buildSeed();
  return {
    // The empty baseline must NOT claim social links already exist, otherwise the
    // first sync diffs them as "unchanged" and never inserts them (settings and
    // footer are force-upserted separately).
    settings: { ...seed.settings, social: [] },
    courses: [],
    pages: [],
    navigation: [],
    footer: seed.footer,
    forms: [],
    media: [],
    documents: [],
    links: [],
    seo: [],
    users: [],
    activity: [],
    revisions: [],
  };
}

async function reconcile(table: string, prevRows: Row[], nextRows: Row[], forceUpsert = false): Promise<void> {
  const prevMap = new Map(prevRows.map((r) => [String(r.id), r]));
  const nextMap = new Map(nextRows.map((r) => [String(r.id), r]));

  const upserts: Row[] = [];
  nextMap.forEach((row, id) => {
    const before = prevMap.get(id);
    // Singleton tables (settings/footer) are always rewritten: their value diff
    // can be identical even when the row does not exist yet, and cms_social_links
    // has an FK on cms_settings(id) — the parent must always be guaranteed first.
    if (forceUpsert || !before || JSON.stringify(before) !== JSON.stringify(row)) upserts.push(row);
  });

  const deletes: string[] = [];
  prevMap.forEach((_row, id) => {
    if (!nextMap.has(id)) deletes.push(id);
  });

  if (upserts.length) {
    const { error } = await supabase.from(table).upsert(upserts);
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
  if (deletes.length) {
    const { error } = await supabase.from(table).delete().in("id", deletes);
    if (error) throw new Error(`${table} delete: ${error.message}`);
  }
}

/**
 * Tables with a single, fixed-id row. Their diff can report "no change" while
 * the row is actually absent from the database, so they are always upserted.
 * cms_settings MUST be written before cms_social_links (FK dependency).
 */
const SINGLETON_TABLES = new Set(["cms_settings", "cms_footer"]);

export async function persistAdminData(prev: AdminData, next: AdminData): Promise<void> {
  const prevSets = tableSets(prev);
  const nextSets = tableSets(next);
  for (const table of TABLE_ORDER) {
    await reconcile(table, prevSets[table] ?? [], nextSets[table] ?? [], SINGLETON_TABLES.has(table));
  }
}
