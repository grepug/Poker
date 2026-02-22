import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type NextHandActionAreaMode = "pregame" | "nextHand";

type NextHandActionAreaProps = {
  mode: NextHandActionAreaMode;
  canReady: boolean;
  hasReadied: boolean;
  canEndGame: boolean;
  canRandomizeSeats?: boolean;
  isRandomizingSeats?: boolean;
  onReady: () => void;
  onOpenEndGameConfirm: () => void;
  onRandomizeSeats?: () => void;
  t: Translate;
};

export const NextHandActionArea: React.FC<NextHandActionAreaProps> = ({
  mode,
  canReady,
  hasReadied,
  canEndGame,
  canRandomizeSeats = false,
  isRandomizingSeats = false,
  onReady,
  onOpenEndGameConfirm,
  onRandomizeSeats,
  t,
}) => {
  const isPreGame = mode === "pregame";
  if (mode === "nextHand" && !canReady) {
    return null;
  }
  if (isPreGame && !canReady && !canRandomizeSeats) {
    return null;
  }

  const showReadyButton = mode === "nextHand" || canReady;
  const readyButtonTestId = isPreGame ? "start-game-button" : "start-next-hand-button";
  const title = isPreGame ? t("game.pregame.actionTitle") : t("game.handComplete");
  const hint = isPreGame ? t("game.pregame.actionHint") : t("game.handCompleteHint");

  return (
    <section className="operation-action-bar" data-testid="next-hand-action-area">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-emerald-100">{title}</h3>
          <p className="text-xs text-emerald-100/70">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showReadyButton && (
            <button
              onClick={onReady}
              disabled={hasReadied}
              data-testid={readyButtonTestId}
              className="operation-action-button operation-action-button--primary"
            >
              {hasReadied ? t("game.ready.waitingOthers") : t("common.ready")}
            </button>
          )}
          {isPreGame && canRandomizeSeats && onRandomizeSeats && (
            <button
              onClick={onRandomizeSeats}
              disabled={isRandomizingSeats}
              data-testid="randomize-seats-button"
              className="operation-action-button operation-action-button--secondary"
            >
              {isRandomizingSeats
                ? t("game.pregame.randomizingSeats")
                : t("game.pregame.randomizeSeats")}
            </button>
          )}
          {canEndGame && (
            <button
              onClick={onOpenEndGameConfirm}
              data-testid="end-game-button"
              className="operation-action-button operation-action-button--danger"
            >
              {t("game.endGame")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
