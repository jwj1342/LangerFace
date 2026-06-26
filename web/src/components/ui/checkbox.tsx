import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (props, ref) => (
    <input ref={ref} type="checkbox" {...props} />
  ),
);
Checkbox.displayName = "Checkbox";
