import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface ProviderConnectionStatusProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "" | "ok" | "warn";
}

export const ProviderConnectionStatus = forwardRef<HTMLSpanElement, ProviderConnectionStatusProps>(
  ({ className, tone = "", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(tone ? `provider-state-${tone}` : undefined, className)}
      {...props}
    />
  ),
);
ProviderConnectionStatus.displayName = "ProviderConnectionStatus";

interface EditStatusProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

export const EditStatus = forwardRef<HTMLSpanElement, EditStatusProps>(
  ({ active = false, className, ...props }, ref) => (
    <span ref={ref} className={cn("edit-status", active && "active", className)} {...props} />
  ),
);
EditStatus.displayName = "EditStatus";

interface ReviewStatusProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "" | "approved" | "rejected" | "revision";
}

export const ReviewStatus = forwardRef<HTMLSpanElement, ReviewStatusProps>(
  ({ className, tone = "", ...props }, ref) => (
    <span ref={ref} className={cn("review-state", tone, className)} {...props} />
  ),
);
ReviewStatus.displayName = "ReviewStatus";
