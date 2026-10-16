import { defaultOgImage, siteName, siteUrl } from "@/data/seo";

export type StructuredDataValue = Record<string, unknown>;

/* Renders schema.org JSON-LD. React places the script inline in the document,
   which is valid for JSON-LD anywhere in the page. */
export function StructuredData({ data }: { data: StructuredDataValue[] }) {
  return (
    <>
      {data.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}

type SeoProps = {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  jsonLd?: StructuredDataValue[];
};

/* Per-page metadata. React 19 hoists <title>, <meta> and <link> rendered here
   into the document <head>, so every route gets its own title, description,
   canonical URL, social tags and structured data. */
export default function Seo({ title, description, path, image, type = "website", jsonLd }: SeoProps) {
  const fullTitle = title.includes(siteName) ? title : `${title} | ${siteName}`;
  const canonical = path === "/" ? `${siteUrl}/` : `${siteUrl}${path}`;
  const ogImage = image ?? defaultOgImage;

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content="en_AU" />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      {jsonLd && jsonLd.length > 0 ? <StructuredData data={jsonLd} /> : null}
    </>
  );
}