/**
 * Canonical social platforms and their icon (Remix Icon) mapping.
 * Used by the CMS social manager (auto-assign icon on platform select) and by
 * the public read layer to resolve the stored icon. No external icon package
 * is required — Remix Icon already ships with the project.
 */

export type SocialPlatform = { label: string; icon: string };

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { label: "Facebook", icon: "ri-facebook-fill" },
  { label: "Instagram", icon: "ri-instagram-line" },
  { label: "LinkedIn", icon: "ri-linkedin-fill" },
  { label: "YouTube", icon: "ri-youtube-fill" },
  { label: "X (Twitter)", icon: "ri-twitter-x-fill" },
  { label: "WhatsApp", icon: "ri-whatsapp-fill" },
  { label: "TikTok", icon: "ri-tiktok-fill" },
  { label: "Pinterest", icon: "ri-pinterest-fill" },
  { label: "Snapchat", icon: "ri-snapchat-fill" },
  { label: "Threads", icon: "ri-threads-fill" },
];

const ALIASES: Record<string, string> = {
  twitter: "X (Twitter)",
  x: "X (Twitter)",
  "x/twitter": "X (Twitter)",
  "x (twitter)": "X (Twitter)",
  fb: "Facebook",
  yt: "YouTube",
  ig: "Instagram",
  whatsapp: "WhatsApp",
};

/** Maps common aliases (e.g. "Twitter") to the canonical platform label. */
export function normalizePlatform(label: string): string {
  const clean = label.trim();
  return ALIASES[clean.toLowerCase()] ?? clean;
}

/** Returns the icon class for a platform label, falling back to a generic link. */
export function socialIconFor(label: string): string {
  const normalized = normalizePlatform(label).toLowerCase();
  const match = SOCIAL_PLATFORMS.find((platform) => platform.label.toLowerCase() === normalized);
  return match?.icon ?? "ri-links-line";
}

export function isKnownPlatform(label: string): boolean {
  const normalized = normalizePlatform(label).toLowerCase();
  return SOCIAL_PLATFORMS.some((platform) => platform.label.toLowerCase() === normalized);
}