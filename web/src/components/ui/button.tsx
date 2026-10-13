import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/* shadcn/ui Button, on the site's tokens. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-canvas shadow-xs hover:bg-ink/90",
        gold: "bg-accent text-[#171813] shadow-xs hover:bg-accent-hover",
        outline: "border border-line bg-paper shadow-xs hover:bg-paper-muted",
        ghost: "hover:bg-paper-muted",
      },
      size: {
        default: "h-9 px-4 py-2",
        lg: "h-11 rounded-md px-6 text-[15px]",
        sm: "h-8 gap-1.5 rounded-md px-3",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({ className, variant, size, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size, className }))} data-slot="button" {...props} />;
}

export { Button, buttonVariants };
