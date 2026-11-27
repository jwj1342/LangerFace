import { forwardRef } from "react";

import { cn } from "../../lib/cn";
import { Button, type ButtonProps } from "./button";

interface SurgeryCutButtonProps extends ButtonProps {
  active?: boolean;
}

export const SurgeryCutButton = forwardRef<HTMLButtonElement, SurgeryCutButtonProps>(
  ({ active = false, className, variant = "workbench", ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      className={cn("cut-along", active && "active", className)}
      {...props}
    />
  ),
);
SurgeryCutButton.displayName = "SurgeryCutButton";
