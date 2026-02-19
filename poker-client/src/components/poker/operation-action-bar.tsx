import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type OperationActionBarMode = "showdown" | "streetReveal";

type OperationActionBarProps = {
  mode: OperationActionBarMode;
  isResultRevealStep: boolean;
  canRevealNextStreet: boolean;
  hasRevealedNextStreet: boolean;
  canShowMyHand: boolean;
  hasShownMyHand: boolean;
  canMuckMyHand: boolean;
  hasMuckedMyHand: boolean;
  onRevealNextStreet: () => void;
  onShowMyHand: () => void;
  onMuckMyHand: () => void;
  t: Translate;
};

export const OperationActionBar: React.FC<OperationActionBarProps> = ({
  mode,
  isResultRevealStep,
  canRevealNextStreet,
  hasRevealedNextStreet,
  canShowMyHand,
  hasShownMyHand,
  canMuckMyHand,
  hasMuckedMyHand,
  onRevealNextStreet,
  onShowMyHand,
  onMuckMyHand,
  t,
}) => {
  if (mode === "showdown") {
    return (
      <section className="operation-action-bar" data-testid="showdown-action-area">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-emerald-100">{t("game.showdown.actionTitle")}</h3>
            <p className="text-xs text-emerald-100/70">{t("game.showdown.actionHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onShowMyHand}
              disabled={!canShowMyHand || hasShownMyHand || hasMuckedMyHand}
              data-testid="show-my-hand-button"
              className="rounded-xl border border-cyan-400/60 bg-cyan-900/30 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-800/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hasShownMyHand ? t("game.showdown.shown") : t("game.showdown.show")}
            </button>
            <button
              onClick={onMuckMyHand}
              disabled={!canMuckMyHand || hasMuckedMyHand || hasShownMyHand}
              data-testid="muck-my-hand-button"
              className="rounded-xl border border-amber-300/70 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hasMuckedMyHand ? t("game.showdown.mucked") : t("game.showdown.muck")}
            </button>
          </div>
        </div>
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
  );
};
