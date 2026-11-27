import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface LegendProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "canvas";
}

export const Legend = forwardRef<HTMLDivElement, LegendProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(variant === "canvas" ? "canvas-legend" : "legend", className)}
      {...props}
    />
  ),
);
Legend.displayName = "Legend";

export const LegendSwatch = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("legend-sw", className)} {...props} />
  ),
);
LegendSwatch.displayName = "LegendSwatch";

interface CanvasLegendItemProps extends HTMLAttributes<HTMLSpanElement> {
  swatchClassName?: string;
}

export const CanvasLegendItem = forwardRef<HTMLSpanElement, CanvasLegendItemProps>(
  ({ children, className, swatchClassName, ...props }, ref) => (
    <span ref={ref} className={cn("legend-item", className)} {...props}>
      <span className={cn("legend-swatch", swatchClassName)} />
      {children}
    </span>
  ),
);
CanvasLegendItem.displayName = "CanvasLegendItem";
