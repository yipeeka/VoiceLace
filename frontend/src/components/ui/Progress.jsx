import * as RadixProgress from "@radix-ui/react-progress";
import { cn } from "../../utils/cn";

/**
 * Props: value (0-100), color: 'primary' | 'cool' | 'success' | 'danger', className
 */
export default function Progress({ value = 0, color = "primary", className }) {
  return (
    <RadixProgress.Root
      className={cn("progressRoot", className)}
      value={value}
      max={100}
    >
      <RadixProgress.Indicator
        className={cn(
          "progressIndicator",
          color === "cool" && "cool",
          color === "success" && "success",
          color === "danger" && "danger"
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </RadixProgress.Root>
  );
}
