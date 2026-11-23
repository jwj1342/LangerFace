import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface ButtonRowProps extends HTMLAttributes<HTMLDivElement> {
  hiddenClassName?: string;
  visible?: boolean;
}

export const ButtonRow = forwardRef<HTMLDivElement, ButtonRowProps>(
  ({ className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <div ref={ref} className={cn("btn-row", !visible && hiddenClassName, className)} {...props} />
  ),
);
ButtonRow.displayName = "ButtonRow";
