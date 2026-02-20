import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type NextHandActionAreaProps = {
  canReadyNextHand: boolean;
  hasReadiedNextHand: boolean;
  canEndGame: boolean;
  onReadyNextHand: () => void;
  onOpenEndGameConfirm: () => void;
  t: Translate;
};

export const NextHandActionArea: React.FC<NextHandActionAreaProps> = ({
  canReadyNextHand,
  hasReadiedNextHand,
  canEndGame,
  onReadyNextHand,
  onOpenEndGameConfirm,
  t,
}) => {
  if (!canReadyNextHand) {
    return null;
  }

  return (
    <section className="operation-action-bar" data-testid="next-hand-action-area">
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
          {canEndGame && (
            <button
              onClick={onOpenEndGameConfirm}
              data-testid="end-game-button"
              className="rounded-xl border border-rose-300/70 bg-rose-500/25 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/35"
            >
              {t("game.endGame")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
