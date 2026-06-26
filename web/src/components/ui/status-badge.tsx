import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface StatusBadgeProps extends HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

export const StatusBadge = forwardRef<HTMLElement, StatusBadgeProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "span";
    return <Comp ref={ref} className={cn("badge", className)} {...props} />;
  },
);
StatusBadge.displayName = "StatusBadge";

export const RouteStatus = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("react-route-status", className)} {...props} />
  ),
);
RouteStatus.displayName = "RouteStatus";
