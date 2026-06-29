import { Html } from "@react-three/drei";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

interface R3FLoadingCardProps {
  children: ReactNode;
  className?: string;
}

export function R3FLoadingCard({ children, className }: R3FLoadingCardProps) {
  return (
    <Html center>
      <div className={cn("rounded-[4px] border border-white/10 bg-black/60 px-4 py-3 text-center text-sm font-bold text-[#dbe4ee]", className)}>
        {children}
      </div>
    </Html>
  );
}
