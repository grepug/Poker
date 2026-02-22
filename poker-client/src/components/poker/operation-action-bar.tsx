import React from "react";
import type { MessageKey } from "@/i18n/messages";
import { useAnchoredPopover } from "@/components/poker/use-anchored-popover";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type OperationActionBarMode = "showdown" | "streetReveal";

type OperationActionBarProps = {
  mode: OperationActionBarMode;
  isAutomationMode: boolean;
  isResultRevealStep: boolean;
  canRevealNextStreet: boolean;
  hasRevealedNextStreet: boolean;
  canShowMyHand: boolean;
  hasShownMyHand: boolean;
  canFoldMyHand: boolean;
  hasFoldedMyHand: boolean;
  showdownIsDecisionTurn: boolean;
  showdownWaitingPlayerName: string | null;
  showdownIsForcedRevealTurn: boolean;
  onRevealNextStreet: () => void;
  onShowMyHand: () => void;
  onFoldMyHand: () => void;
  t: Translate;
};

export const OperationActionBar: React.FC<OperationActionBarProps> = ({
  mode,
  isAutomationMode,
  isResultRevealStep,
  canRevealNextStreet,
  hasRevealedNextStreet,
  canShowMyHand,
  hasShownMyHand,
  canFoldMyHand,
  hasFoldedMyHand,
  showdownIsDecisionTurn,
  showdownWaitingPlayerName,
  showdownIsForcedRevealTurn,
  onRevealNextStreet,
  onShowMyHand,
  onFoldMyHand,
  t,
}) => {
  const [showFoldQuickConfirm, setShowFoldQuickConfirm] = React.useState(false);
  const foldActionButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const foldQuickConfirmRef = React.useRef<HTMLDivElement | null>(null);
  const foldQuickConfirmStyle = useAnchoredPopover({
    isOpen: !isAutomationMode && showFoldQuickConfirm,
    anchorRef: foldActionButtonRef,
    popoverRef: foldQuickConfirmRef,
    preferredPlacement: "top",
    align: "end",
  });

  React.useEffect(() => {
    if (mode !== "showdown" || !showdownIsDecisionTurn) {
      setShowFoldQuickConfirm(false);
    }
  }, [mode, showdownIsDecisionTurn]);

  if (mode === "showdown") {
    return (
      <section className="operation-action-bar" data-testid="showdown-action-area">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-emerald-100">{t("game.showdown.actionTitle")}</h3>
            {showdownIsDecisionTurn && (
              <p className="text-xs text-emerald-100/70">
                {showdownIsForcedRevealTurn
                  ? t("game.showdown.forcedRevealHint")
                  : t("game.showdown.actionHint")}
              </p>
            )}
          </div>
          {showdownIsDecisionTurn && (
            <div className="relative flex flex-wrap items-center gap-2">
              {!isAutomationMode && showFoldQuickConfirm && (
                <div
                  ref={foldQuickConfirmRef}
                  role="dialog"
                  aria-label={t("game.confirmAction.title")}
                  data-testid="action-quick-confirm-popover"
                  className="action-quick-confirm-popover"
                  style={foldQuickConfirmStyle}
                >
                  <p className="text-xs font-semibold text-emerald-50">
                    {t("game.quickConfirm.prompt", {
                      action: t("common.fold"),
                    })}
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowFoldQuickConfirm(false)}
                      data-testid="action-quick-confirm-cancel"
                      className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowFoldQuickConfirm(false);
                        onFoldMyHand();
                      }}
                      data-testid="action-quick-confirm-accept"
                      className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300"
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={onShowMyHand}
                disabled={!canShowMyHand || hasShownMyHand || hasFoldedMyHand}
                data-testid="show-my-hand-button"
                className="operation-action-button operation-action-button--secondary"
              >
                {hasShownMyHand ? t("game.showdown.shown") : t("game.showdown.show")}
              </button>
              {!showdownIsForcedRevealTurn && (
                <button
                  ref={foldActionButtonRef}
                  onClick={() => {
                    if (isAutomationMode) {
                      onFoldMyHand();
                      return;
                    }
                    setShowFoldQuickConfirm(true);
                  }}
                  disabled={!canFoldMyHand || hasFoldedMyHand || hasShownMyHand}
                  data-testid="fold-my-hand-button"
                  className="operation-action-button operation-action-button--danger"
                >
                  {hasFoldedMyHand ? t("game.showdown.mucked") : t("common.fold")}
                </button>
              )}
            </div>
          )}
        </div>
        {!showdownIsDecisionTurn && (
          <p className="mt-2 text-xs text-emerald-100/70" data-testid="showdown-waiting-hint">
            {showdownWaitingPlayerName
              ? t("game.showdown.waitingHint", { name: showdownWaitingPlayerName })
              : t("game.showdown.waitingHintUnknown")}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="operation-action-bar" data-testid="reveal-next-street-action-area">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-emerald-100">
            {isResultRevealStep
              ? t("game.streetReveal.resultActionTitle")
              : t("game.streetReveal.actionTitle")}
          </h3>
          <p className="text-xs text-emerald-100/70">
            {isResultRevealStep
              ? t("game.streetReveal.resultActionHint")
              : t("game.streetReveal.actionHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onRevealNextStreet}
            disabled={!canRevealNextStreet || hasRevealedNextStreet}
            data-testid="reveal-next-street-button"
            className="operation-action-button operation-action-button--secondary"
          >
            {hasRevealedNextStreet
              ? t("game.streetReveal.revealed")
              : isResultRevealStep
                ? t("game.streetReveal.revealResult")
                : t("game.streetReveal.revealNextStreet")}
          </button>
        </div>
      </div>
    </section>
  );
};
