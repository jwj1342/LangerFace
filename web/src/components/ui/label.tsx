import { forwardRef } from "react";
import type { LabelHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("field-label", className)} {...props} />
  ),
);
Label.displayName = "Label";
