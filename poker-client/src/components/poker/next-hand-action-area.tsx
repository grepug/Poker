import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type NextHandActionAreaProps = {
  canReadyNextHand: boolean;
  hasReadiedNextHand: boolean;
  waitingForOthersNextHand: boolean;
  showNextStreetActionArea: boolean;
  isResultRevealStep: boolean;
  canRevealNextStreet: boolean;
  hasRevealedNextStreet: boolean;
  onReadyNextHand: () => void;
  onOpenEndGameConfirm: () => void;
  onRevealNextStreet: () => void;
  t: Translate;
};

export const NextHandActionArea: React.FC<NextHandActionAreaProps> = ({
  canReadyNextHand,
  hasReadiedNextHand,
  waitingForOthersNextHand,
  showNextStreetActionArea,
  isResultRevealStep,
  canRevealNextStreet,
  hasRevealedNextStreet,
  onReadyNextHand,
  onOpenEndGameConfirm,
  onRevealNextStreet,
  t,
}) => {
  return (
    <>
      {canReadyNextHand && (
        <section className="surface-panel mx-3 mt-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-emerald-100">{t("game.handComplete")}</h3>
              <p className="text-xs text-emerald-100/70">{t("game.handCompleteHint")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onReadyNextHand}
                disabled={hasReadiedNextHand}
                data-testid="start-next-hand-button"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {hasReadiedNextHand ? t("game.ready.waitingOthers") : t("common.ready")}
              </button>
              <button
                onClick={onOpenEndGameConfirm}
                data-testid="end-game-button"
                className="rounded-xl border border-rose-300/70 bg-rose-500/25 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/35"
              >
                {t("game.endGame")}
              </button>
            </div>
          </div>
        </section>
      )}

      {waitingForOthersNextHand && (
        <section className="surface-panel mx-3 mt-3 p-4" data-testid="waiting-host-start-next-hand">
          <div>
            <h3 className="text-sm font-semibold text-emerald-100">{t("game.handComplete")}</h3>
            <p className="text-xs text-emerald-100/70">{t("game.ready.waitingOthers")}</p>
          </div>
        </section>
      )}

      {showNextStreetActionArea && (
        <section className="surface-panel mx-3 mt-3 p-4" data-testid="reveal-next-street-action-area">
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
                className="rounded-xl border border-cyan-400/60 bg-cyan-900/30 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-800/45 disabled:cursor-not-allowed disabled:opacity-60"
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
      )}
    </>
  );
};
