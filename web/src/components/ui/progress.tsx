import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  fillClassName?: string;
  fillProps?: HTMLAttributes<HTMLDivElement>;
  value?: number | null;
}

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ className, fillClassName, fillProps, value, ...props }, ref) => {
    const { className: fillPropsClassName, style: fillPropsStyle, ...restFillProps } = fillProps ?? {};
    const fillStyle = value === undefined || value === null
      ? fillPropsStyle
      : { ...fillPropsStyle, width: `${clampPercent(value)}%` };

    return (
      <div ref={ref} className={cn("bar", className)} {...props}>
        <div
          {...restFillProps}
          className={cn("bar-fill", fillClassName, fillPropsClassName)}
          style={fillStyle}
        />
      </div>
    );
  },
);
ProgressBar.displayName = "ProgressBar";
