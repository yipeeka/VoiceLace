import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../../utils/cn";

export function Tabs({ defaultValue, value, onValueChange, children, className }) {
  return (
    <RadixTabs.Root
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      className={cn("tabsRoot", className)}
    >
      {children}
    </RadixTabs.Root>
  );
}

export function TabsList({ children, className }) {
  return <RadixTabs.List className={cn("tabsList", className)}>{children}</RadixTabs.List>;
}

export function TabsTrigger({ value, children, className }) {
  return (
    <RadixTabs.Trigger value={value} className={cn("tabsTrigger", className)}>
      {children}
    </RadixTabs.Trigger>
  );
}

export function TabsContent({ value, children, className }) {
  return (
    <RadixTabs.Content value={value} className={cn("tabsContent", className)}>
      {children}
    </RadixTabs.Content>
  );
}
