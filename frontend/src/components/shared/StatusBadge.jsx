const tones = {
  default: { background: "rgba(124, 231, 255, 0.12)", color: "var(--accent-cool)" },
  success: { background: "rgba(84, 211, 154, 0.14)", color: "var(--success)" },
  warning: { background: "rgba(255, 209, 102, 0.14)", color: "var(--warning)" },
};

export default function StatusBadge({ label, tone = "default" }) {
  return (
    <span className="statusBadge" style={tones[tone] || tones.default}>
      {label}
    </span>
  );
}
