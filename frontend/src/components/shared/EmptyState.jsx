import { cn } from "../../utils/cn";

export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("emptyState", className)}>
      {Icon && <Icon size={32} style={{ color: "var(--text-muted)", marginBottom: 4 }} />}
      {title && (
        <span style={{ color: "var(--text-secondary)", fontWeight: 500, fontSize: 14 }}>
          {title}
        </span>
      )}
      {description && (
        <span style={{ color: "var(--text-muted)", fontSize: 12.5 }}>{description}</span>
      )}
      {action}
    </div>
  );
}
