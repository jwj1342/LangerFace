import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface LiveOverlayQaProps extends HTMLAttributes<HTMLDivElement> {
  hiddenClassName?: string;
  tone?: "neutral" | "ok" | "warn";
  visible?: boolean;
}

export const LiveOverlayQa = forwardRef<HTMLDivElement, LiveOverlayQaProps>(
  ({ className, hiddenClassName = "hidden", tone = "neutral", visible = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("overlay-qa", tone !== "neutral" && tone, !visible && hiddenClassName, className)}
      {...props}
    />
  ),
);
LiveOverlayQa.displayName = "LiveOverlayQa";

export const LiveOverlayQaHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("overlay-qa-top", className)} {...props} />
  ),
);
LiveOverlayQaHeader.displayName = "LiveOverlayQaHeader";
