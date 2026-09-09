import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";
import type { Workspace } from "../stores/appStore";

type WorkbenchLayoutWorkspace = Extract<Workspace, "annotate" | "incision" | "live" | "surgery" | "workflow">;

interface WorkbenchFrameProps extends HTMLAttributes<HTMLDivElement> {
  workspace: WorkbenchLayoutWorkspace;
}

export function WorkbenchFrame({ workspace, className, ...props }: WorkbenchFrameProps) {
  return <div className={cn("app", "clinical-compat-workbench", `${workspace}-workbench`, className)} {...props} />;
}

export function WorkbenchSidebar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <aside className={cn("sidebar", className)} {...props} />;
}

interface WorkbenchLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  secondarySidebar?: ReactNode;
  secondarySidebarClassName?: string;
  secondarySidebarLabel?: string;
  sidebarClassName?: string;
  sidebarLabel?: string;
  stage: ReactNode;
  workspace: WorkbenchLayoutWorkspace;
}

export function WorkbenchLayout({
  children,
  className,
  secondarySidebar,
  secondarySidebarClassName,
  secondarySidebarLabel,
  sidebarClassName,
  sidebarLabel,
  stage,
  workspace,
  ...props
}: WorkbenchLayoutProps) {
  const sidebar = (
    <WorkbenchSidebar aria-label={sidebarLabel} className={sidebarClassName}>
      {children}
    </WorkbenchSidebar>
  );
  const trailingSidebar = secondarySidebar ? (
    <WorkbenchSidebar aria-label={secondarySidebarLabel} className={secondarySidebarClassName}>
      {secondarySidebar}
    </WorkbenchSidebar>
  ) : null;

  return (
    <WorkbenchFrame workspace={workspace} className={className} {...props}>
      {workspace === "incision" ? stage : sidebar}
      {workspace === "incision" ? sidebar : stage}
      {trailingSidebar}
    </WorkbenchFrame>
  );
}

export function Disclaimer({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("disclaimer", className)} {...props} />;
}
