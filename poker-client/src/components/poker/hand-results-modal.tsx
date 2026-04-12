import React from "react";
import type { MessageKey } from "@/i18n/messages";
import { PokerModalPanel, PokerModalShell } from "./modal-shell";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type HandResultsModalProps = {
  children?: React.ReactNode;
  ariaLabel: string;
  footer?: React.ReactNode;
  onClose: () => void;
  t: Translate;
};

export const HandResultsModal = React.forwardRef<HTMLElement, HandResultsModalProps>(
  ({ children, ariaLabel, footer, onClose, t }, ref) => (
    <PokerModalShell
      layout="page"
      testId="hand-results-modal"
      zIndexClassName="z-[74]"
      contentClassName="mx-auto w-full max-w-4xl"
    >
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex justify-end">
          <button
            onClick={onClose}
            data-testid="close-hand-results-button"
            className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
          >
            {t("common.close")}
          </button>
        </div>
        <PokerModalPanel
          ref={ref}
          className="p-4 md:p-6"
          testId="hand-results-panel"
          ariaLabel={ariaLabel}
          viewportBounded={false}
        >
          {children}
        </PokerModalPanel>
        {footer ? <div className="mt-3">{footer}</div> : null}
      </div>
    </PokerModalShell>
  ),
);

HandResultsModal.displayName = "HandResultsModal";
