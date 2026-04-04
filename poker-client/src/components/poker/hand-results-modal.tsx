import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type HandResultsModalProps = {
  children?: React.ReactNode;
  onClose: () => void;
  t: Translate;
};

export const HandResultsModal = React.forwardRef<HTMLElement, HandResultsModalProps>(
  ({ children, onClose, t }, ref) => (
    <div
      className="fixed inset-0 z-[74] overflow-y-auto bg-emerald-950/88 p-4 backdrop-blur-sm"
      data-testid="hand-results-modal"
      role="dialog"
      aria-modal="true"
    >
      <section
        ref={ref}
        className="surface-panel mx-auto w-full max-w-4xl p-4 md:p-6"
        data-testid="hand-results-panel"
      >
        <div className="mb-3 flex justify-end">
          <button
            onClick={onClose}
            data-testid="close-hand-results-button"
            className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
          >
            {t("common.close")}
          </button>
        </div>
        {children}
      </section>
    </div>
  ),
);

HandResultsModal.displayName = "HandResultsModal";
