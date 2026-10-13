"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * shadcn/ui ToggleGroup (outline variant, as in the dashboard-01 block's "Last 3 months / 30 days"
 * switch), on the site's tokens. Radix handles keyboard and roving focus. The ON state is styled in
 * globals.css ([data-slot=toggle-group-item][data-state=on]) so it always beats hover and base colours.
 */
function ToggleGroup({ className, children, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root className={cn("flex flex-wrap items-center gap-1.5", className)} data-slot="toggle-group" {...props}>
      {children}
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({ className, children, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex h-9 min-w-11 items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 text-sm font-medium text-ink-soft shadow-xs transition-colors outline-none",
        "hover:bg-paper-muted hover:text-ink focus-visible:ring-[3px] focus-visible:ring-accent/40",
        className,
      )}
      data-slot="toggle-group-item"
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
