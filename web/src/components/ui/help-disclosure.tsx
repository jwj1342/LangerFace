import type { DetailsHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Card } from "./card";

interface HelpDisclosureProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> {
  title: ReactNode;
}

export function HelpDisclosure({ children, className, open = true, title, ...props }: HelpDisclosureProps) {
  return (
    <Card asChild className={cn("help-doc", className)}>
      <details open={open} {...props}>
        <summary>{title}</summary>
        {children}
      </details>
    </Card>
  );
}
