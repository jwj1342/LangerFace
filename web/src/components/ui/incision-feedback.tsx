import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface WarnTextProps extends HTMLAttributes<HTMLParagraphElement> {
  warn?: boolean;
}

export const BoundaryStatus = forwardRef<HTMLParagraphElement, WarnTextProps>(
  ({ className, warn = false, ...props }, ref) => (
    <p ref={ref} className={cn("boundary-status", warn && "warn", className)} {...props} />
  ),
);
BoundaryStatus.displayName = "BoundaryStatus";

export const AnatomyPreview = forwardRef<HTMLParagraphElement, WarnTextProps>(
  ({ className, warn = false, ...props }, ref) => (
    <p ref={ref} className={cn("anatomy-preview", warn && "warn", className)} {...props} />
  ),
);
AnatomyPreview.displayName = "AnatomyPreview";

interface GuardrailDetailsProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: "neutral" | "warn" | "danger";
}

export const GuardrailDetails = forwardRef<HTMLParagraphElement, GuardrailDetailsProps>(
  ({ className, tone = "neutral", ...props }, ref) => (
    <p
      ref={ref}
      className={cn("guardrail-details", tone !== "neutral" && tone, className)}
      {...props}
    />
  ),
);
GuardrailDetails.displayName = "GuardrailDetails";
