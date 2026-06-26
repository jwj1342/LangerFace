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

export const LiveScanPanel = forwardRef<HTMLDivElement, LiveOverlayQaProps>(
  ({ className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <div ref={ref} className={cn("scan-panel", !visible && hiddenClassName, className)} {...props} />
  ),
);
LiveScanPanel.displayName = "LiveScanPanel";

export const LiveScanRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("scan-row", className)} {...props} />
  ),
);
LiveScanRow.displayName = "LiveScanRow";

export const LiveYawMeter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("yaw-meter", className)} {...props} />
  ),
);
LiveYawMeter.displayName = "LiveYawMeter";
