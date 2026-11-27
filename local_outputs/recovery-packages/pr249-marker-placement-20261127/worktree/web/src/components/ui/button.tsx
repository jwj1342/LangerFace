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
        default: "inline-flex h-10 items-center justify-center gap-2 rounded-[4px] border border-[#3e4b59] bg-[#151b23] px-3 text-sm font-semibold text-[#e5eaf0] transition hover:border-[#5b6b7a] hover:bg-[#1c2530] disabled:pointer-events-none disabled:opacity-45",
        primary: "inline-flex h-10 items-center justify-center gap-2 rounded-[4px] border border-[#0f62fe] bg-[#0f62fe] px-3 text-sm font-semibold text-[#f4f7fb] transition hover:border-[#0043ce] hover:bg-[#0043ce] disabled:pointer-events-none disabled:opacity-45",
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
  hiddenClassName?: string;
  visible?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, hiddenClassName = "hidden", variant, size, asChild = false, visible = true, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), !visible && hiddenClassName, className)} {...props} />;
  },
);
Button.displayName = "Button";
