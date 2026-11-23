import type { ReactNode } from "react";

interface WorkbenchBrandProps {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}

export function WorkbenchBrand({ eyebrow, title, action }: WorkbenchBrandProps) {
  return (
    <div className="brand">
      <div className="brand-top">
        <span className="eyebrow">{eyebrow}</span>
        {action}
      </div>
      <h1>{title}</h1>
    </div>
  );
}
