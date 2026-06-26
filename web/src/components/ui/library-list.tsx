import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const CandidateList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("candidate-list", className)} {...props} />
  ),
);
CandidateList.displayName = "CandidateList";

export const CandidateRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("candidate-row", className)} {...props} />
  ),
);
CandidateRow.displayName = "CandidateRow";

export const CandidateRowTop = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("top", className)} {...props} />
  ),
);
CandidateRowTop.displayName = "CandidateRowTop";

export const CandidateRowMeta = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("meta", className)} {...props} />
  ),
);
CandidateRowMeta.displayName = "CandidateRowMeta";

export interface CandidateRowStatusProps extends HTMLAttributes<HTMLSpanElement> {
  danger?: boolean;
}

export const CandidateRowStatus = forwardRef<HTMLSpanElement, CandidateRowStatusProps>(
  ({ className, danger = false, ...props }, ref) => (
    <span ref={ref} className={cn(danger && "danger-text", className)} {...props} />
  ),
);
CandidateRowStatus.displayName = "CandidateRowStatus";

export const LineList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("line-list", className)} {...props} />
  ),
);
LineList.displayName = "LineList";

export interface LineRowProps extends HTMLAttributes<HTMLDivElement> {
  warn?: boolean;
}

export const LineRow = forwardRef<HTMLDivElement, LineRowProps>(
  ({ className, warn = false, ...props }, ref) => (
    <div ref={ref} className={cn("line-row", warn && "has-warning", className)} {...props} />
  ),
);
LineRow.displayName = "LineRow";

export const LineMain = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("line-main", className)} {...props} />
  ),
);
LineMain.displayName = "LineMain";

export const LineMeta = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("line-meta", className)} {...props} />
  ),
);
LineMeta.displayName = "LineMeta";

export const LineWarning = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("line-warning", className)} {...props} />
  ),
);
LineWarning.displayName = "LineWarning";

export const LineActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("line-actions", className)} {...props} />
  ),
);
LineActions.displayName = "LineActions";

export const LineEmpty = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("line-empty", className)} {...props} />
  ),
);
LineEmpty.displayName = "LineEmpty";
