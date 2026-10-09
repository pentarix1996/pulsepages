// Brand accent for public status pages: the project's brand_color drives buttons, focus rings and links, with text
// colors chosen by WCAG contrast so any brand stays readable in the light and dark themes. Pure.

export const DEFAULT_ACCENT = '#0E7490'
/** Link color on the dark theme when the page keeps the default accent (DESIGN.md §2). */
export const DEFAULT_DARK_LINK = '#7CD3E6'

const LIGHT_SURFACE = '#FFFFFF'
const DARK_SURFACE = '#131B2C'
const INK = '#121826'
const WHITE = '#FFFFFF'

type Rgb = [number, number, number]

export function parseHex(value: string | null | undefined): Rgb | null {
  if (!value) return null
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const hex = match[1]!
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/** WCAG 2 contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return 1
  const [hi, lo] = [relativeLuminance(x), relativeLuminance(y)].sort((m, n) => n - m) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** White or ink, whichever reads better on `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

/**
 * The closest version of `color` (same hue and saturation, lighter or darker) that reaches `minRatio` against
 * `background`. Returns the color unchanged when it already does.
 */
export function ensureContrast(color: string, background: string, minRatio = 4.5): string {
  const rgb = parseHex(color)
  if (!rgb) return color
  if (contrastRatio(color, background) >= minRatio) return toHex(rgb)
  const [h, s, l] = rgbToHsl(rgb)
  const lighten = relativeLuminance(parseHex(background) ?? [255, 255, 255]) < 0.2
  for (let step = 1; step <= 100; step++) {
    const lightness = lighten ? Math.min(1, l + step / 100) : Math.max(0, l - step / 100)
    const candidate = toHex(hslToRgb([h, s, lightness]))
    if (contrastRatio(candidate, background) >= minRatio) return candidate
  }
  return lighten ? WHITE : INK
}

export interface BrandPalette {
  /** Button and focus color (the brand color itself). */
  accent: string
  /** Text on accent buttons. */
  accentText: string
  /** Link color on the light theme (contrast ≥ 4.5 on white). */
  link: string
  /** Link color on the dark theme (contrast ≥ 4.5 on the dark surface). */
  linkDark: string
}

export function brandPalette(brandColor: string | null | undefined): BrandPalette {
  const parsed = parseHex(brandColor)
  const accent = parsed ? toHex(parsed) : DEFAULT_ACCENT
  const isDefault = accent === DEFAULT_ACCENT
  return {
    accent,
    accentText: readableTextOn(accent),
    link: ensureContrast(accent, LIGHT_SURFACE),
    linkDark: isDefault ? DEFAULT_DARK_LINK : ensureContrast(accent, DARK_SURFACE),
  }
}

/** CSS custom properties for the page root (consumed by styles/tokens.css and styles/status.css). */
export function brandStyle(brandColor: string | null | undefined): Record<string, string> {
  const palette = brandPalette(brandColor)
  return {
    '--brand-accent': palette.accent,
    '--brand-accent-dark': palette.linkDark,
    '--brand-accent-text': palette.accentText,
    '--brand-link': palette.link,
  }
}
