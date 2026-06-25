import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[10px] border text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-[#e6e8e1] bg-white text-[#1b2024] hover:bg-[#f3f4f0]",
        primary: "border-[#0f9b6e] bg-[#0f9b6e] text-white hover:bg-[#0c8460]",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-8 px-2.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
