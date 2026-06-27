import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export type RangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const RangeInput = forwardRef<HTMLInputElement, RangeInputProps>(
  (props, ref) => (
    <input ref={ref} type="range" {...props} />
  ),
);
RangeInput.displayName = "RangeInput";
