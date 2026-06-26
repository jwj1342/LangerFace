import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Hint = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("hint", className)} {...props} />
  ),
);
Hint.displayName = "Hint";
