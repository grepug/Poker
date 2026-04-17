import React from "react";
import { cn } from "@/lib/utils";

type PokerModalShellProps = {
  children: React.ReactNode;
  layout?: "centered" | "page";
  onBackdropClose?: () => void;
  className?: string;
  contentClassName?: string;
  testId?: string;
  zIndexClassName?: string;
};

type PokerModalPanelProps = {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  scrollMode?: "panel" | "content";
  viewportBounded?: boolean;
};

export const PokerModalShell: React.FC<PokerModalShellProps> = ({
  children,
  layout = "centered",
  onBackdropClose,
  className,
  contentClassName,
  testId,
  zIndexClassName = "z-[75]",
}) => {
  const content = contentClassName ? (
    <div className={contentClassName}>{children}</div>
  ) : (
    children
  );

  return (
    <div
      className={cn(
        "fixed inset-0 bg-emerald-950/88 p-4 backdrop-blur-sm",
        layout === "centered" ? "flex items-center justify-center" : "overflow-y-auto",
        zIndexClassName,
        className,
      )}
      data-testid={testId}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onBackdropClose?.();
        }
      }}
    >
      {content}
    </div>
  );
};

export const PokerModalPanel = React.forwardRef<HTMLElement, PokerModalPanelProps>(
  (
    {
      children,
      className,
      testId,
      ariaLabel,
      ariaLabelledBy,
      scrollMode = "panel",
      viewportBounded = true,
    },
    ref,
  ) => (
    <section
      ref={ref}
      className={cn(
        "surface-panel w-full",
        viewportBounded && "max-h-[calc(100vh-2rem)]",
        scrollMode === "panel" && "overflow-y-auto",
        className,
      )}
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </section>
  ),
);

PokerModalPanel.displayName = "PokerModalPanel";
