import { clsx } from "clsx";

/**
 * Merge class names (clsx wrapper).
 * Usage: cn("base", condition && "extra", { active: isActive })
 */
export function cn(...inputs) {
  return clsx(inputs);
}
