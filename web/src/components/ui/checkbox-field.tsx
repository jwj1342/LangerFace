import { forwardRef } from "react";
import type { LabelHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Checkbox, type CheckboxProps } from "./checkbox";

export interface CheckboxFieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  checkboxProps: CheckboxProps;
  children: ReactNode;
  hiddenClassName?: string;
  visible?: boolean;
}

export const CheckboxField = forwardRef<HTMLLabelElement, CheckboxFieldProps>(
  ({ checkboxProps, children, className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <label ref={ref} className={cn("check", !visible && hiddenClassName, className)} {...props}>
      <Checkbox {...checkboxProps} /> {children}
    </label>
  ),
);
CheckboxField.displayName = "CheckboxField";
