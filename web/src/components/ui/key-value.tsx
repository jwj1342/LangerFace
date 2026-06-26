import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface KeyValueGridProps extends HTMLAttributes<HTMLDivElement> {
  hiddenClassName?: string;
  visible?: boolean;
}

export const KeyValueGrid = forwardRef<HTMLDivElement, KeyValueGridProps>(
  ({ className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <div ref={ref} className={cn(!visible && hiddenClassName, className)} {...props} />
  ),
);
KeyValueGrid.displayName = "KeyValueGrid";

export interface KeyValueItemProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  labelProps?: HTMLAttributes<HTMLSpanElement>;
  value: ReactNode;
  valueProps?: HTMLAttributes<HTMLSpanElement>;
}

export const KeyValueItem = forwardRef<HTMLDivElement, KeyValueItemProps>(
  ({ className, label, labelProps, value, valueProps, ...props }, ref) => (
    <div ref={ref} className={className} {...props}>
      <span {...labelProps} className={cn("k", labelProps?.className)}>{label}</span>
      <span {...valueProps} className={cn("v", valueProps?.className)}>{value}</span>
    </div>
  ),
);
KeyValueItem.displayName = "KeyValueItem";

export const MetricGrid = forwardRef<HTMLDivElement, KeyValueGridProps>(
  ({ className, ...props }, ref) => (
    <KeyValueGrid ref={ref} className={cn("metric-grid", className)} {...props} />
  ),
);
MetricGrid.displayName = "MetricGrid";

export const MetricItem = forwardRef<HTMLDivElement, KeyValueItemProps>(
  ({ className, ...props }, ref) => (
    <KeyValueItem ref={ref} className={cn("metric", className)} {...props} />
  ),
);
MetricItem.displayName = "MetricItem";

export const StatGrid = forwardRef<HTMLDivElement, KeyValueGridProps>(
  ({ className, ...props }, ref) => (
    <KeyValueGrid ref={ref} className={cn("stat-grid", className)} {...props} />
  ),
);
StatGrid.displayName = "StatGrid";

export const StatItem = forwardRef<HTMLDivElement, KeyValueItemProps>(
  ({ className, ...props }, ref) => (
    <KeyValueItem ref={ref} className={cn("stat", className)} {...props} />
  ),
);
StatItem.displayName = "StatItem";
