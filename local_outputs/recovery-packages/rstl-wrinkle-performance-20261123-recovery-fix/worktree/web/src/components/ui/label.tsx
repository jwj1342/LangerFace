import { forwardRef } from "react";
import type { HTMLAttributes, LabelHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("field-label", className)} {...props} />
  ),
);
Label.displayName = "Label";

export const FieldValue = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("val", className)} {...props} />
  ),
);
FieldValue.displayName = "FieldValue";
