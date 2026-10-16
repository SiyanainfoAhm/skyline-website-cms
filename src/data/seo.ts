import type { Course } from "./courses";
import type { CourseDetail } from "./courseDetails";
import { site } from "./site";

/* Central SEO configuration and schema.org builders.
   The public site is served from slit.edu.au, so canonical URLs are absolute
   against that origin (the Readdy preview origin is not used for SEO signals). */

export const siteUrl = "https://slit.edu.au";
export const siteName = site.name;
export const siteShortName = site.shortName;

export const defaultOgImage =
  "https://static.readdy.ai/image/7fe129f8d7ac12cdc97a659d50dae110/10672c8cbcfc600c6073bd57b6040721.jpeg";

export const siteDescription =
  "Skyline Institute Of Technology (RTO 45989, CRICOS 04114B) delivers hands-on technical education and training in Melbourne across automotive, building and construction, civil construction design, furnishing, glazing and business.";

export const socialProfiles: string[] = site.social.map((item) => item.href);

export const organizationSchema: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": ["EducationalOrganization", "LocalBusiness", "School"],
  name: siteName,
  alternateName: siteShortName,
  url: siteUrl,
  logo: "https://slit.edu.au/wp-content/uploads/2023/06/cropped-site-270x270.png",
  image: defaultOgImage,
  description: siteDescription,
  telephone: "+61391251661",
  email: site.email,
  address: {
    "@type": "PostalAddress",
    streetAddress: "Level 8, 310 King St",
    addressLocality: "Melbourne",
    addressRegion: "VIC",
    postalCode: "3000",
    addressCountry: "AU",
  },
  areaServed: {
    "@type": "Country",
    name: "Australia",
  },
  sameAs: socialProfiles,
};

export const websiteSchema: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteName,
  url: siteUrl,
  inLanguage: "en-AU",
  publisher: {
    "@type": "EducationalOrganization",
    name: siteName,
    url: siteUrl,
  },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${siteUrl}/our-courses?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export function breadcrumbSchema(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.path === "/" ? "" : item.path}`,
    })),
  };
}

export function courseListSchema(list: Course[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Courses at ${siteName}`,
    numberOfItems: list.length,
    itemListElement: list.map((course, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: course.name,
      url: `${siteUrl}/courses/${course.slug}`,
    })),
  };
}

export function courseSchema(course: Course, detail?: CourseDetail): Record<string, unknown> {
  const weeksMatch = course.duration ? course.duration.match(/\d+/) : null;
  const weeks = weeksMatch ? Number(weeksMatch[0]) : NaN;
  const priceMatch = detail?.fee?.total ? detail.fee.total.match(/[\d,]+(?:\.\d+)?/) : null;
  const price = priceMatch ? priceMatch[0].replace(/,/g, "") : undefined;

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: course.name,
    description: detail?.overview ?? course.summary ?? course.name,
    url: `${siteUrl}/courses/${course.slug}`,
    inLanguage: "en-AU",
    provider: {
      "@type": "EducationalOrganization",
      name: siteName,
      url: siteUrl,
    },
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "Onsite",
      courseWorkload: "PT20H",
    },
  };

  if (course.code) schema.courseCode = course.code;
  if (Number.isFinite(weeks) && weeks > 0) schema.timeRequired = `P${weeks}W`;
  if (detail?.qualification) {
    schema.educationalCredentialAwarded = course.name;
  }
  if (price) {
    schema.offers = {
      "@type": "Offer",
      category: "Course fee",
      priceCurrency: "AUD",
      price,
      url: `${siteUrl}/enroll-now`,
      availability: "https://schema.org/InStock",
    };
  }

  return schema;
}