import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface FieldGroupProps extends HTMLAttributes<HTMLDivElement> {
  hiddenClassName?: string;
  visible?: boolean;
}

export const FieldGroup = forwardRef<HTMLDivElement, FieldGroupProps>(
  ({ className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <div ref={ref} className={cn(!visible && hiddenClassName, className)} {...props} />
  ),
);
FieldGroup.displayName = "FieldGroup";
