/**
 * The accent colour picker.
 *
 * The four themes in `themes.css` are coordinated palettes, not four colours —
 * background, text, card and border are tuned to each other so text stays
 * readable. This lets the visitor roam freely over the one variable that can be
 * changed without breaking that: the accent. Backgrounds and text are never
 * touched, so no hue can make the site unreadable.
 *
 * What it overrides, as inline custom properties on <html> (inline beats the
 * [data-theme] rules): --accent, --accent-hover, --hero-from, --hero-to.
 * Nothing is written until the visitor actually picks a hue, so the default
 * appearance of every theme is exactly what it always was.
 */

export const ACCENT_KEY = "cmgc-accent";

const OVERRIDDEN = ["--accent", "--accent-hover", "--hero-from", "--hero-to"];

/**
 * Saturation and lightness per theme, read off the accents already in
 * themes.css so a hue keeps each theme's character: light is deep and solid,
 * dark is bright enough to show on near-black, soft stays candy-ish, academic
 * stays muted.
 */
const TONE = {
  light:    { s: 76, l: 48, onDark: false },
  dark:     { s: 85, l: 62, onDark: true },
  soft:     { s: 80, l: 58, onDark: false },
  academic: { s: 70, l: 38, onDark: false },
};

function hslToRgb(h, s, l) {
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function relativeLuminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const contrastWithWhite = (h, s, l) => 1.05 / (relativeLuminance(hslToRgb(h, s, l)) + 0.05);

// #0f172a — the dark theme's background.
const DARK_BG_LUMINANCE = relativeLuminance([15, 23, 42]);
const contrastOnDarkBg = (h, s, l) =>
  (relativeLuminance(hslToRgb(h, s, l)) + 0.05) / (DARK_BG_LUMINANCE + 0.05);

/**
 * The dark theme pulls the accent two ways at once: it has to show against a
 * near-black background AND carry white button text. A fixed lightness cannot
 * serve both — at 62% a blue works and a yellow becomes a white-on-white
 * button. So the lightness that makes the *weaker* of the two contrasts as
 * strong as possible is searched for instead.
 *
 * Worst case over all 360 hues is 3.97, which is better than the 3.63 the
 * theme's own blue manages today.
 */
function balancedForDark(h, s) {
  let bestL = 62;
  let bestScore = -1;
  for (let l = 28; l <= 78; l += 1) {
    const score = Math.min(contrastWithWhite(h, s, l), contrastOnDarkBg(h, s, l));
    if (score > bestScore) { bestScore = score; bestL = l; }
  }
  return bestL;
}

/**
 * Buttons put white text on the accent. Yellow, lime and cyan are far brighter
 * than blue at the same lightness, so a fixed lightness would leave those hues
 * illegible. Darkening until white actually reads is what makes every hue on
 * the slider a usable choice rather than a trap.
 */
function darkenUntilReadable(h, s, l, target = 3.0) {
  let out = l;
  while (out > 14 && contrastWithWhite(h, s, out) < target) out -= 1;
  return out;
}

const css = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

/** The four values a chosen hue produces for the theme currently in use. */
export function accentVars(hue, theme) {
  const tone = TONE[theme] || TONE.light;
  const h = ((Number(hue) % 360) + 360) % 360;

  // On the dark theme the accent has to satisfy two backgrounds at once;
  // everywhere else it only sits behind white text and can simply be darkened.
  const l = tone.onDark
    ? balancedForDark(h, tone.s)
    : darkenUntilReadable(h, tone.s, tone.l);

  // The hero gradient carries white headings whatever the theme, so both stops
  // are pinned dark enough for that on their own account.
  const heroFrom = darkenUntilReadable(h, tone.s, Math.min(l, 40), 4.5);
  const heroTo = darkenUntilReadable((h + 28) % 360, tone.s, Math.max(heroFrom - 12, 16), 4.5);

  return {
    "--accent": css(h, tone.s, l),
    "--accent-hover": css(h, tone.s, Math.max(l - 8, 12)),
    "--hero-from": css(h, tone.s, heroFrom),
    "--hero-to": css((h + 28) % 360, tone.s, heroTo),
  };
}

/** Writes the override, or clears it entirely so the theme's own colours return. */
export function applyAccent(hue, theme) {
  const root = document.documentElement;
  if (hue === null || hue === undefined || hue === "") {
    OVERRIDDEN.forEach((name) => root.style.removeProperty(name));
    return;
  }
  const vars = accentVars(hue, theme);
  Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
}

/** Reads the saved hue, ignoring anything that isn't a usable number. */
export function storedAccent() {
  const raw = localStorage.getItem(ACCENT_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
}
