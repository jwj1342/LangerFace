import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  hiddenClassName?: string;
  visible?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ asChild = false, className, hiddenClassName = "hidden", visible = true, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return <Comp ref={ref} className={cn("card", !visible && hiddenClassName, className)} {...props} />;
  },
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("quality-top", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardHeaderTitle = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("inline-flex items-center gap-2", className)} {...props} />
  ),
);
CardHeaderTitle.displayName = "CardHeaderTitle";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-3", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";
