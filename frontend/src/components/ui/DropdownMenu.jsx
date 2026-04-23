import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "../../utils/cn";

export default function DropdownMenu({
  label = "更多",
  icon: Icon,
  variant = "ghost",
  size = "md",
  items = [],
  align = "end",
  sideOffset = 8,
  className,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);

  async function handleSelect(item) {
    if (item?.disabled || typeof item?.onSelect !== "function") {
      return;
    }
    setOpen(false);
    await item.onSelect();
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "btn",
            `btn-${variant}`,
            size === "sm" && "btn-sm",
            size === "lg" && "btn-lg",
            "dropdownMenuTrigger",
            className,
          )}
        >
          {Icon ? <Icon size={size === "sm" ? 13 : size === "lg" ? 17 : 15} /> : null}
          <span className="dropdownMenuLabel">{label}</span>
          <ChevronDown className="dropdownMenuChevron" size={size === "sm" ? 13 : size === "lg" ? 17 : 15} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content className="dropdownMenuContent" align={align} sideOffset={sideOffset}>
          <div className="dropdownMenuList" role="menu">
            {items.map((item, index) => {
              if (item?.type === "separator") {
                return <div key={`separator-${index}`} className="dropdownMenuSeparator" />;
              }
              const ItemIcon = item?.icon;
              return (
                <button
                  key={`${item?.label || "item"}-${index}`}
                  type="button"
                  role="menuitem"
                  className={cn(
                    "dropdownMenuItem",
                    item?.danger && "danger",
                    item?.disabled && "disabled",
                  )}
                  title={item?.title || item?.label}
                  disabled={item?.disabled}
                  onClick={() => handleSelect(item)}
                >
                  {ItemIcon ? <ItemIcon size={14} /> : null}
                  <span>{item?.label}</span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
