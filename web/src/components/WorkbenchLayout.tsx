import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";

interface WorkbenchLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  stage: ReactNode;
}

export function WorkbenchLayout({ children, className, stage, ...props }: WorkbenchLayoutProps) {
  return (
    <div className={cn("app", className)} {...props}>
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
