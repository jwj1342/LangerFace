import type { HTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

import { cn } from "../lib/cn";

interface StageShellProps extends HTMLAttributes<HTMLElement> {
  bodyClassName?: string;
  children: ReactNode;
  top: ReactNode;
}

export function StageShell({ bodyClassName, children, className, top, ...props }: StageShellProps) {
  return (
    <main className={cn("stage", className)} {...props}>
      <div className="stage-top">{top}</div>
      <div className={cn("stage-body", bodyClassName)}>{children}</div>
    </main>
  );
}

export function StageActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("stage-actions", className)} {...props} />;
}

interface StageStatusProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

export function StageStatus({ active = false, children, className, ...props }: StageStatusProps) {
  return (
    <span className={cn("live", active && "on", className)} {...props}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function StageMeta({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("fps", className)} {...props} />;
}

export function StageViewport({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("main-wrap", className)} {...props} />;
}

interface StageLinkProps extends LinkProps {
  variant?: "default" | "meta";
}

export function StageLink({ className, variant = "default", ...props }: StageLinkProps) {
  return <Link className={cn("stage-link", variant === "meta" && "fps", className)} {...props} />;
}
