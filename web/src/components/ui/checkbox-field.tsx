import { forwardRef } from "react";
import type { LabelHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Checkbox, type CheckboxProps } from "./checkbox";

export interface CheckboxFieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  checkboxProps: CheckboxProps;
  children: ReactNode;
}

export const CheckboxField = forwardRef<HTMLLabelElement, CheckboxFieldProps>(
  ({ checkboxProps, children, className, ...props }, ref) => (
    <label ref={ref} className={cn("check", className)} {...props}>
      <Checkbox {...checkboxProps} /> {children}
    </label>
  ),
);
CheckboxField.displayName = "CheckboxField";
