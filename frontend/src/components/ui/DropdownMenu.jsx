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
  ariaLabel,
  hideLabel = false,
  showChevron = true,
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
          aria-label={ariaLabel || label}
          className={cn(
            "btn",
            `btn-${variant}`,
            size === "sm" && "btn-sm",
            size === "lg" && "btn-lg",
            "dropdownMenuTrigger",
            className,
          )}
        >
          {Icon ? <Icon aria-hidden="true" focusable="false" size={size === "sm" ? 13 : size === "lg" ? 17 : 15} /> : null}
          {!hideLabel ? <span className="dropdownMenuLabel">{label}</span> : null}
          {showChevron ? (
            <ChevronDown className="dropdownMenuChevron" aria-hidden="true" focusable="false" size={size === "sm" ? 13 : size === "lg" ? 17 : 15} />
          ) : null}
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
                  {ItemIcon ? <ItemIcon aria-hidden="true" focusable="false" size={14} /> : null}
                  <span className="dropdownMenuItemCopy">
                    <span>{item?.label}</span>
                    {item?.meta ? <small>{item.meta}</small> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
