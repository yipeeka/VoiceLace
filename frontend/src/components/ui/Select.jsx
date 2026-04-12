import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";

// Radix Select forbids empty-string values, so we map "" <-> this sentinel internally.
const NONE = "__none__";

function toRadix(v) { return v === "" || v == null ? NONE : v; }
function fromRadix(v) { return v === NONE ? "" : v; }

/**
 * Props:
 *   value, onValueChange, options: [{value, label}], placeholder, disabled, className
 *
 * options with value="" are supported — they render as a "clear / none" item.
 */
export default function Select({
  value,
  onValueChange,
  options = [],
  placeholder = "选择...",
  disabled = false,
  className,
}) {
  // Only show a value in Radix when it isn't the "none" sentinel
  const radixValue = value === "" || value == null ? undefined : value;

  return (
    <RadixSelect.Root
      value={radixValue}
      onValueChange={(v) => onValueChange?.(fromRadix(v))}
      disabled={disabled}
    >
      <RadixSelect.Trigger className={cn("selectTrigger", className)}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={13} style={{ color: "var(--text-muted)" }} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content className="selectContent" position="popper" sideOffset={4}>
          <RadixSelect.Viewport>
            {options.map((opt) => {
              const itemValue = toRadix(opt.value);
              return (
                <RadixSelect.Item key={itemValue} value={itemValue} className="selectItem">
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator style={{ marginLeft: "auto" }}>
                    <Check size={12} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              );
            })}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
