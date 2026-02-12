import React from "react";
import { cn } from "@/lib/utils";

type HandResultsPanelProps = {
  children: React.ReactNode;
  className?: string;
  testId?: string;
};

export const HandResultsPanel = React.forwardRef<HTMLElement, HandResultsPanelProps>(
  ({ children, className, testId = "hand-results-panel" }, ref) => {
    return (
      <section
        ref={ref}
        className={cn("surface-panel mx-3 mt-3 p-4", className)}
        data-testid={testId}
      >
        {children}
      </section>
    );
  },
);

HandResultsPanel.displayName = "HandResultsPanel";
