import { cn } from "../../utils/cn";

/** Rewritten GlassCard using new design tokens */
export default function GlassCard({ children, className, elevated = false, style, ...props }) {
  return (
    <div className={cn("glassCard", elevated && "elevated", className)} style={style} {...props}>
      {children}
    </div>
  );
}
