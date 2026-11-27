import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import { Hint } from "./hint";

interface PrivacyAuditToneProps {
  blocked?: boolean;
}

export const PrivacyStateText = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement> & PrivacyAuditToneProps>(
  ({ blocked = false, className, ...props }, ref) => (
    <span ref={ref} className={cn(blocked && "danger-text", className)} {...props} />
  ),
);
PrivacyStateText.displayName = "PrivacyStateText";

export const PrivacyAuditMessage = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement> & PrivacyAuditToneProps>(
  ({ blocked = false, className, ...props }, ref) => (
    <Hint ref={ref} className={cn(blocked && "danger-text", className)} {...props} />
  ),
);
PrivacyAuditMessage.displayName = "PrivacyAuditMessage";
