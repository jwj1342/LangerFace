import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface CurrentLineStatusProps extends HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  warn?: boolean;
}

export const CurrentLineStatus = forwardRef<HTMLDivElement, CurrentLineStatusProps>(
  ({ active = false, className, warn = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("current-state", active && "active", warn && "warning", className)}
      {...props}
    />
  ),
);
CurrentLineStatus.displayName = "CurrentLineStatus";
