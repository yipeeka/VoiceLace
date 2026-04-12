import * as RadixTooltip from "@radix-ui/react-tooltip";

export function TooltipProvider({ children }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={100}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({ content, children, side = "top" }) {
  if (!content) return children;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tooltipContent" side={side} sideOffset={6}>
          {content}
          <RadixTooltip.Arrow style={{ fill: "var(--bg-elevated)" }} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
