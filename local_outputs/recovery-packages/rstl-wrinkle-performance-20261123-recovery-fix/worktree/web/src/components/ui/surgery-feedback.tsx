import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import { Hint } from "./hint";

export type SurgeryVerdictTone = "neutral" | "ok" | "warn";

interface SurgeryVerdictProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: SurgeryVerdictTone;
}

export const SurgeryVerdict = forwardRef<HTMLParagraphElement, SurgeryVerdictProps>(
  ({ className, tone = "neutral", ...props }, ref) => (
    <Hint
      ref={ref}
      className={cn(`surgery-verdict-${tone}`, className)}
      {...props}
    />
  ),
);
SurgeryVerdict.displayName = "SurgeryVerdict";
