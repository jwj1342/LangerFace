import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface SectionTitleProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value?: ReactNode;
  valueProps?: HTMLAttributes<HTMLSpanElement>;
}

export const SectionTitle = forwardRef<HTMLDivElement, SectionTitleProps>(
  ({ className, label, value, valueProps, ...props }, ref) => (
    <div ref={ref} className={cn("section-title", className)} {...props}>
      <span>{label}</span>
      {value === undefined ? null : <span {...valueProps}>{value}</span>}
    </div>
  ),
);
SectionTitle.displayName = "SectionTitle";
