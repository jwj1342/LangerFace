import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "",
  {
    variants: {
      variant: {
        default: "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#e6e8e1] bg-white px-3 text-sm font-semibold text-[#1b2024] transition hover:bg-[#f3f4f0] disabled:pointer-events-none disabled:opacity-45",
        primary: "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#0f9b6e] bg-[#0f9b6e] px-3 text-sm font-semibold text-white transition hover:bg-[#0c8460] disabled:pointer-events-none disabled:opacity-45",
        workbench: "btn",
        workbenchPrimary: "btn btn-primary",
        mini: "mini",
        miniDanger: "mini del",
      },
      size: {
        default: "",
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
