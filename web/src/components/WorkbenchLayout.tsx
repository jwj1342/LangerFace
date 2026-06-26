import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";

type WorkbenchLayoutWorkspace = "annotate" | "incision" | "live" | "surgery";

interface WorkbenchLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  stage: ReactNode;
  workspace: WorkbenchLayoutWorkspace;
}

export function WorkbenchLayout({
  children,
  className,
  stage,
  workspace,
  ...props
}: WorkbenchLayoutProps) {
  return (
    <div className={cn("app", `${workspace}-workbench`, className)} {...props}>
      <aside className="sidebar">
        {children}
      </aside>
      {stage}
    </div>
  );
}

export function Disclaimer({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("disclaimer", className)} {...props} />;
}
