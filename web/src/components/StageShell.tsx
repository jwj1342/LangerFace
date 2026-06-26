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

export function StageViewport({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("main-wrap", className)} {...props} />;
}

export function StageLink({ className, ...props }: LinkProps) {
  return <Link className={cn("stage-link", className)} {...props} />;
}
