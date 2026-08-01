import { RotateCcw } from "lucide-react";
import "./AccentPicker.css";

/**
 * The rainbow bar beside the four theme dots.
 *
 * It sets a hue, not a colour: how saturated and how dark that hue ends up is
 * decided per theme in `accent.js`, which is what keeps every position on the
 * bar a usable choice. Dragging to yellow gives a readable gold, not a white
 * button nobody can read.
 */
export default function AccentPicker({ hue, setHue, compact = false }) {
  const active = hue !== null;

  return (
    <div className={"accent " + (compact ? "accent--compact" : "")}>
      <input
        type="range"
        min="0"
        max="359"
        step="1"
        // Nothing is chosen yet: park the handle on a mid position rather than
        // at 0, which would read as "red is selected".
        value={active ? hue : 210}
        onChange={(e) => setHue(Number(e.target.value))}
        className={"accent__range " + (active ? "" : "accent__range--idle")}
        aria-label="Accent colour"
        title={active ? `Accent hue ${hue}°` : "Drag to choose an accent colour"}
      />
      <button
        type="button"
        className="accent__reset"
        onClick={() => setHue(null)}
        disabled={!active}
        aria-label="Reset accent to the theme's own colour"
        title="Back to the theme's own colour"
      >
        <RotateCcw size={13} />
      </button>
    </div>
  );
}
