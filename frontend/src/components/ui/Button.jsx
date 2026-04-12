import { cn } from "../../utils/cn";

/**
 * Button variants: 'primary' | 'secondary' | 'ghost' | 'danger'
 * Sizes: 'sm' | 'md' | 'lg'
 */
export default function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  children,
  className,
  ...props
}) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        `btn-${variant}`,
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        !children && Icon && "btn-icon",
        className
      )}
      {...props}
    >
      {Icon && <Icon size={size === "sm" ? 13 : size === "lg" ? 17 : 15} />}
      {children}
      {IconRight && <IconRight size={size === "sm" ? 13 : size === "lg" ? 17 : 15} />}
    </button>
  );
}
