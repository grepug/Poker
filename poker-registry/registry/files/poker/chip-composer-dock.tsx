import React from "react";
import { cn } from "@/lib/utils";

type ChipComposerDockProps = {
  children: React.ReactNode;
  className?: string;
  testId?: string;
};

export const ChipComposerDock = React.forwardRef<HTMLElement, ChipComposerDockProps>(
  ({ children, className, testId = "turn-overlay" }, ref) => {
    return (
      <section
        ref={ref}
        className={cn("chip-composer-dock", className)}
        data-testid={testId}
      >
        {children}
      </section>
    );
  },
);

ChipComposerDock.displayName = "ChipComposerDock";
