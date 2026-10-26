import type { CSSProperties } from "react";

export interface SiteTheme { primaryColor: string; headingFont: string; bodyFont: string }
const fonts = new Set(["Arial", "Georgia", "Verdana", "system-ui"]);

/** Convert an approved sRGB color to the OKLCH tokens used by existing CSS. */
export function tenantThemeStyle(theme?: SiteTheme): CSSProperties {
  if (!theme || !/^#[a-f\d]{6}$/i.test(theme.primaryColor) || !fonts.has(theme.headingFont) || !fonts.has(theme.bodyFont)) return {};
  const rgb = [1, 3, 5].map((offset) => {
    const value = parseInt(theme.primaryColor.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, labB), hue = (Math.atan2(labB, a) * 180 / Math.PI + 360) % 360;
  const tokens: Record<string, string> = { "--font-heading": theme.headingFont, "--font-body": theme.bodyFont, "--font-label": theme.bodyFont };
  for (const [shade, lum] of [[50, .97], [100, .94], [200, .88], [300, .8], [400, .7], [500, lightness], [600, lightness * .88], [700, lightness * .74], [800, lightness * .62], [900, lightness * .5], [950, lightness * .4]]) {
    tokens[`--primary-${shade}`] = `${lum.toFixed(4)} ${(chroma * (shade < 500 ? shade / 500 : 1)).toFixed(4)} ${hue.toFixed(2)}`;
  }
  return tokens as CSSProperties;
}
