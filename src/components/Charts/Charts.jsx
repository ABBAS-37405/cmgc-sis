import { useState, useRef, useEffect } from "react";
import "./Charts.css";

/**
 * The whole charting layer, in inline SVG.
 *
 * There is no chart library here on purpose. Recharts and its peers are 90-300 kB,
 * and the landing bundle is held at ~428 kB (see Performance in CLAUDE.md) — a
 * dependency that size to draw four shapes would be the most expensive thing in
 * the app. These primitives are a few hundred lines and import nothing.
 *
 * Everything they draw follows one set of rules, so charts across the three
 * portals read as one system rather than four people's taste:
 *
 * - **One series, one colour.** Nothing here cycles hues, because none of these
 *   charts plots two things at once. The categorical slots exist in the CSS for
 *   when one does; they are validated (CVD-separated) as a set, not picked by eye.
 * - **Marks are thin and the chrome is recessive.** Bars cap at 24px with a 4px
 *   rounded end and a square baseline, lines are 2px, markers are 8px with a 2px
 *   ring in the surface colour, gridlines are solid hairlines one step off the
 *   surface. Saturated blocks and heavy grids read as loud and, at this size,
 *   childish.
 * - **Every chart carries its numbers.** `ChartCard` takes a `table`, rendered
 *   under a "Show the numbers" toggle. A tooltip may never be the only way to
 *   read a value — and on the light themes the aqua slot sits below 3:1 against
 *   the card, so the table is the documented relief for it too.
 * - **A number is never printed for a value nobody recorded.** Callers pass only
 *   what exists; `empty` draws the reason instead of an axis with nothing on it.
 *
 * Sizing is measured, not scaled: a ResizeObserver gives the real pixel width and
 * the SVG is drawn at that size, so 11px axis text is 11px on a phone as well as
 * a desktop. Scaling a fixed viewBox would shrink the labels to nothing on the
 * screen most of these parents actually hold.
 */

/* ------------------------------------------------------------------ layout */

/** The element's real width in CSS pixels, 0 until it has been measured. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      // Ignore sub-pixel churn: without this, a 0.5px reflow re-renders forever.
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Axis ticks at clean numbers, so the reader is never asked to divide by 7. */
function ticksFor(max, count = 4) {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step));
}

/**
 * A bar with a 4px rounded data-end and a square baseline.
 *
 * `rect rx` would round all four corners, which lifts the bar off its own
 * baseline and makes short bars look like pills.
 */
function columnPath(x, y, w, h, r = 4) {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

function barPath(x, y, w, h, r = 4) {
  const radius = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h - radius} Q${x + w},${y + h} ${x + w - radius},${y + h} L${x},${y + h} Z`;
}

/* -------------------------------------------------------------- the shell */

/**
 * One chart, its title, and the numbers behind it.
 *
 * `table` is not optional decoration — it is the WCAG-clean twin every chart
 * here is required to have.
 */
export function ChartCard({ title, subtitle, empty, emptyText, table, children }) {
  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span className="chart__title">{title}</span>
        {subtitle && <span className="chart__subtitle">{subtitle}</span>}
      </figcaption>

      {empty ? (
        <p className="chart__empty">{emptyText || "Nothing recorded yet."}</p>
      ) : (
        <>
          {children}
          {table && (
            <details className="chart__numbers">
              <summary>Show the numbers</summary>
              <div className="chart__numbers-body">{table}</div>
            </details>
          )}
        </>
      )}
    </figure>
  );
}

/**
 * The floating read-out. Positioned in pixels, because the plot is drawn in them.
 *
 * It flips against the near edge rather than always centring on the mark: a
 * centred tooltip on the last column hangs past the card, and on a phone that is
 * enough to make the whole page scroll sideways.
 */
function Tooltip({ at, width, lines }) {
  if (!at) return null;
  const edge = at.x > width - 90 ? "end" : at.x < 90 ? "start" : "center";
  return (
    <div className={`chart__tip chart__tip--${edge}`} style={{ left: at.x, top: at.y }} role="status">
      {lines.map((l, i) => (
        <span key={i} className={i === 0 ? "chart__tip-head" : "chart__tip-line"}>{l}</span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ column */

/**
 * Values over an ordered axis — months of attendance, marks per test.
 *
 * `reference` draws a labelled threshold (75% attendance, 33% pass). It is what
 * lets a colour on a failing bar be reinforcement rather than the only signal:
 * the bar is visibly under a labelled line, whether or not the reader sees red.
 */
export function ColumnChart({
  data, max = 100, suffix = "%", reference = null, height = 210, label = "Chart",
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  // A reference line needs its label parked outside the plot. Right-aligning it
  // inside puts "75%" on top of the last two bars as soon as the card is narrow.
  const padding = { top: 16, right: reference ? 34 : 8, bottom: 40, left: 38 };
  const plotW = Math.max(width - padding.left - padding.right, 10);
  const plotH = height - padding.top - padding.bottom;
  const band = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.max(Math.min(24, band - 12), 6);
  const yOf = (v) => padding.top + plotH - (Math.max(0, Math.min(v, max)) / max) * plotH;
  // Direct labels are worth it only while they still fit without touching.
  const showValues = data.length <= 8 && band >= 34;
  // On a narrow phone twelve months do not get twelve legible labels, and
  // overlapping text is worse than less of it. Every other one, counted from the
  // right so the most recent is always the one that keeps its name.
  const labelEvery = band < 26 ? 2 : 1;

  return (
    <div className="chart__plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="chart__svg">
          {ticksFor(max).map((t) => (
            <g key={t}>
              <line
                className="chart__grid"
                x1={padding.left} x2={padding.left + plotW} y1={yOf(t)} y2={yOf(t)}
              />
              <text className="chart__tick" x={padding.left - 7} y={yOf(t) + 3.5} textAnchor="end">{t}</text>
            </g>
          ))}

          {reference && reference.value <= max && (
            <g>
              <line
                className="chart__reference"
                x1={padding.left} x2={padding.left + plotW} y1={yOf(reference.value)} y2={yOf(reference.value)}
              />
              <text
                className="chart__reference-label"
                x={padding.left + plotW + 5} y={yOf(reference.value) + 3.5}
              >
                {reference.label}
              </text>
            </g>
          )}

          {data.map((d, i) => {
            const x = padding.left + i * band + (band - barW) / 2;
            const y = yOf(d.value);
            const h = padding.top + plotH - y;
            const active = hover?.index === i;

            return (
              <g key={d.label + i}>
                <path
                  d={columnPath(x, y, barW, Math.max(h, 2))}
                  className={`chart__mark chart__mark--${d.tone || "series1"} ${active ? "chart__mark--active" : ""}`}
                />
                {showValues && (
                  <text className="chart__value" x={x + barW / 2} y={y - 6} textAnchor="middle">
                    {Math.round(d.value)}{suffix}
                  </text>
                )}
                {(data.length - 1 - i) % labelEvery === 0 && (
                  <>
                    <text className="chart__axis-label" x={padding.left + i * band + band / 2} y={height - 22} textAnchor="middle">
                      {d.label}
                    </text>
                    {d.sublabel && (
                      <text className="chart__axis-sublabel" x={padding.left + i * band + band / 2} y={height - 9} textAnchor="middle">
                        {d.sublabel}
                      </text>
                    )}
                  </>
                )}
                {/* The hit area is the whole band, never the 6px bar: a pinpoint
                    target is unusable, and it has to be keyboard-reachable. */}
                <rect
                  x={padding.left + i * band} y={padding.top} width={band} height={plotH}
                  fill="transparent" tabIndex={0} className="chart__hit"
                  aria-label={`${d.label}: ${d.tipValue || `${Math.round(d.value)}${suffix}`}`}
                  onMouseEnter={() => setHover({ index: i, x: padding.left + i * band + band / 2, y })}
                  onFocus={() => setHover({ index: i, x: padding.left + i * band + band / 2, y })}
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {hover && (
        <Tooltip
          width={width}
          at={{ x: hover.x, y: hover.y }}
          lines={[data[hover.index].label, data[hover.index].tipValue || `${Math.round(data[hover.index].value)}${suffix}`, data[hover.index].tipNote].filter(Boolean)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- bar (h) */

/**
 * Magnitude across named categories — subjects, groups, teachers.
 *
 * Horizontal because the names are words, not dates: "Tarjama Tul Quran" under a
 * column is either rotated or truncated, and both are worse than a row.
 */
export function BarChart({ data, max = 100, suffix = "%", label = "Chart", nameWidth = 116 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const rowH = 30;
  const barH = 16;
  const valueW = 46;
  const height = Math.max(data.length * rowH + 8, rowH);
  const plotW = Math.max(width - nameWidth - valueW, 10);

  return (
    <div className="chart__plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="chart__svg">
          {data.map((d, i) => {
            const y = i * rowH + 6;
            const w = Math.max((Math.max(0, Math.min(d.value, max)) / max) * plotW, 2);
            const active = hover?.index === i;

            return (
              <g key={d.label + i}>
                {/* 15 characters at 11.5px clears the 116px name column with
                    room to spare. 17 did not: "Tarjama Tul Quran" ran into its
                    own bar, which is the one thing a label may never do. */}
                <text className="chart__row-label" x={0} y={y + barH / 2 + 4}>
                  {d.label.length > 15 ? `${d.label.slice(0, 14)}…` : d.label}
                </text>
                <rect className="chart__track" x={nameWidth} y={y} width={plotW} height={barH} rx={4} />
                <path
                  d={barPath(nameWidth, y, w, barH)}
                  className={`chart__mark chart__mark--${d.tone || "series1"} ${active ? "chart__mark--active" : ""}`}
                />
                <text className="chart__value" x={nameWidth + plotW + 6} y={y + barH / 2 + 4}>
                  {d.valueLabel || `${Math.round(d.value)}${suffix}`}
                </text>
                <rect
                  x={0} y={y - 6} width={Math.max(width, 10)} height={rowH}
                  fill="transparent" tabIndex={0} className="chart__hit"
                  aria-label={`${d.label}: ${d.tipValue || d.valueLabel || `${Math.round(d.value)}${suffix}`}`}
                  onMouseEnter={() => setHover({ index: i, x: nameWidth + w, y })}
                  onFocus={() => setHover({ index: i, x: nameWidth + w, y })}
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {hover && (
        <Tooltip
          width={width}
          at={{ x: hover.x, y: hover.y - 4 }}
          lines={[data[hover.index].label, data[hover.index].tipValue || data[hover.index].valueLabel || `${Math.round(data[hover.index].value)}${suffix}`, data[hover.index].tipNote].filter(Boolean)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- line */

/** A trend the reader is meant to follow: results across sittings, tests over a term. */
export function LineChart({ data, max = 100, suffix = "%", height = 210, label = "Chart", reference = null }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const padding = { top: 18, right: 34, bottom: 40, left: 38 };
  const plotW = Math.max(width - padding.left - padding.right, 10);
  const plotH = height - padding.top - padding.bottom;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xOf = (i) => padding.left + (data.length > 1 ? i * stepX : plotW / 2);
  const yOf = (v) => padding.top + plotH - (Math.max(0, Math.min(v, max)) / max) * plotH;

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(d.value)}`).join(" ");
  const last = data.length - 1;

  return (
    <div className="chart__plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="chart__svg">
          {ticksFor(max).map((t) => (
            <g key={t}>
              <line className="chart__grid" x1={padding.left} x2={padding.left + plotW} y1={yOf(t)} y2={yOf(t)} />
              <text className="chart__tick" x={padding.left - 7} y={yOf(t) + 3.5} textAnchor="end">{t}</text>
            </g>
          ))}

          {reference && reference.value <= max && (
            <>
              <line className="chart__reference" x1={padding.left} x2={padding.left + plotW} y1={yOf(reference.value)} y2={yOf(reference.value)} />
              <text className="chart__reference-label" x={padding.left + plotW} y={yOf(reference.value) - 5} textAnchor="end">{reference.label}</text>
            </>
          )}

          <path d={path} className="chart__line" />

          {data.map((d, i) => (
            <g key={d.label + i}>
              <circle cx={xOf(i)} cy={yOf(d.value)} r={hover?.index === i ? 5.5 : 4} className="chart__dot" />
              {(i === last || i === 0) && data.length > 1 && (
                <text
                  className="chart__value"
                  x={xOf(i)} y={yOf(d.value) - 10}
                  textAnchor={i === last ? "end" : "start"}
                >
                  {Math.round(d.value)}{suffix}
                </text>
              )}
              <text className="chart__axis-label" x={xOf(i)} y={height - 22} textAnchor="middle">{d.label}</text>
              {d.sublabel && (
                <text className="chart__axis-sublabel" x={xOf(i)} y={height - 9} textAnchor="middle">{d.sublabel}</text>
              )}
              <rect
                x={xOf(i) - Math.max(stepX / 2, 14)} y={padding.top}
                width={Math.max(stepX, 28)} height={plotH}
                fill="transparent" tabIndex={0} className="chart__hit"
                aria-label={`${d.label}: ${d.tipValue || `${Math.round(d.value)}${suffix}`}`}
                onMouseEnter={() => setHover({ index: i, x: xOf(i), y: yOf(d.value) })}
                onFocus={() => setHover({ index: i, x: xOf(i), y: yOf(d.value) })}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
      )}

      {hover && (
        <Tooltip
          width={width}
          at={{ x: hover.x, y: hover.y }}
          lines={[data[hover.index].label, data[hover.index].tipValue || `${Math.round(data[hover.index].value)}${suffix}`, data[hover.index].tipNote].filter(Boolean)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- meter */

/**
 * One ratio against its limit — fee paid of fee charged, work handed in of work set.
 *
 * A two-slice pie is the classic wrong answer to this; the track is a lighter
 * step of the fill's own ramp so the state reads across the whole bar.
 */
export function Meter({ label, value, max, valueLabel, note, tone = "series1" }) {
  const percent = max > 0 ? Math.max(0, Math.min((value / max) * 100, 100)) : 0;

  return (
    <div className="meter">
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{valueLabel}</span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${valueLabel}`}
      >
        <div className={`meter__fill meter__fill--${tone}`} style={{ width: `${percent}%` }} />
      </div>
      {note && <span className="meter__note">{note}</span>}
    </div>
  );
}
