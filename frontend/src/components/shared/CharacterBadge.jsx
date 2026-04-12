/**
 * Character color palette — deterministic from character name.
 * Returns a CSS variable reference for the character color.
 */
const CHAR_COLORS = [
  "var(--char-0)", // narrator
  "var(--char-1)",
  "var(--char-2)",
  "var(--char-3)",
  "var(--char-4)",
  "var(--char-5)",
  "var(--char-6)",
  "var(--char-7)",
  "var(--char-8)",
];

const NARRATOR_NAMES = ["旁白", "narrator", "narration", "Narrator", "旁 白"];

/**
 * Get the color variable for a character name.
 * Narrator always gets index 0 (the gray one).
 */
export function getCharColor(name = "") {
  if (!name || NARRATOR_NAMES.some((n) => name.toLowerCase().includes(n.toLowerCase()))) {
    return CHAR_COLORS[0];
  }
  // hash the name to pick a color index (1–8)
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CHAR_COLORS[(hash % 8) + 1];
}

/**
 * CharacterBadge — inline colored pill with character name.
 * Props: name, showDot
 */
export default function CharacterBadge({ name = "旁白", showDot = true, style }) {
  const color = getCharColor(name);
  return (
    <span
      className="charBadge"
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        ...style,
      }}
    >
      {showDot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
            display: "inline-block",
          }}
        />
      )}
      {name}
    </span>
  );
}
