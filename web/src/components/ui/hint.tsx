import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface HintProps extends HTMLAttributes<HTMLParagraphElement> {
  hiddenClassName?: string;
  visible?: boolean;
}

export const Hint = forwardRef<HTMLParagraphElement, HintProps>(
  ({ className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <p ref={ref} className={cn("hint", !visible && hiddenClassName, className)} {...props} />
  ),
);
Hint.displayName = "Hint";

export const AgentNote = forwardRef<HTMLParagraphElement, HintProps>(
  ({ className, hiddenClassName = "hidden", visible = true, ...props }, ref) => (
    <p ref={ref} className={cn("agent-note", !visible && hiddenClassName, className)} {...props} />
  ),
);
AgentNote.displayName = "AgentNote";
