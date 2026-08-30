import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";
import type { Workspace } from "../stores/appStore";

type WorkbenchLayoutWorkspace = Extract<Workspace, "annotate" | "incision" | "live" | "surgery" | "workflow">;

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
    <aside aria-label={sidebarLabel} className={cn("sidebar", sidebarClassName)}>
      {children}
    </aside>
  );
  const trailingSidebar = secondarySidebar ? (
    <aside aria-label={secondarySidebarLabel} className={cn("sidebar", secondarySidebarClassName)}>
      {secondarySidebar}
    </aside>
  ) : null;

  return (
    <div className={cn("app", "clinical-compat-workbench", `${workspace}-workbench`, className)} {...props}>
      {workspace === "incision" ? stage : sidebar}
      {workspace === "incision" ? sidebar : stage}
      {trailingSidebar}
    </div>
  );
}

export function Disclaimer({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("disclaimer", className)} {...props} />;
}
