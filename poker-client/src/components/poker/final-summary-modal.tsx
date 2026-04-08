import React from "react";
import type { GameEndedData } from "poker-types";
import type { MessageKey } from "@/i18n/messages";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type FinalSummaryCard = {
  key: string;
  label: string;
  value: string;
};

type FinalStanding = GameEndedData["standings"][number] & {
  rankOrder: number;
};

type FinalSummaryModalProps = {
  finalGameResult: GameEndedData;
  finalSummaryCards: FinalSummaryCard[];
  finalStandings: FinalStanding[];
  currentPlayerId: string;
  isGameEnded: boolean;
  onExportHistory: () => void;
  isExportingHistory: boolean;
  onOpenSavedHistory: () => void;
  onSaveScreenshot: () => void;
  onLeave: () => void;
  onClose: () => void;
  t: Translate;
};

export const FinalSummaryModal = React.forwardRef<
  HTMLElement,
  FinalSummaryModalProps
>(
  (
    {
      finalGameResult,
      finalSummaryCards,
      finalStandings,
      currentPlayerId,
      isGameEnded,
      onExportHistory,
      isExportingHistory,
      onOpenSavedHistory,
      onSaveScreenshot,
      onLeave,
      onClose,
      t,
    },
    ref,
  ) => (
    <div
      className="fixed inset-0 z-[78] overflow-y-auto bg-emerald-950/88 p-4 backdrop-blur-sm"
      data-testid="final-summary-modal"
    >
      <section
        ref={ref}
        className="surface-panel mx-auto w-full max-w-4xl p-4 md:p-6"
        data-testid="final-summary-panel"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-white">{t("game.final.title")}</h3>
            <p className="mt-1 text-sm text-emerald-100/80">{t("game.final.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onExportHistory}
              disabled={isExportingHistory}
              data-testid="export-game-history-button"
              className="rounded-full border border-violet-300/55 bg-violet-900/30 px-3 py-1 text-xs font-semibold text-violet-100 transition hover:bg-violet-800/40 disabled:cursor-wait disabled:opacity-70"
            >
              {isExportingHistory
                ? t("game.final.exportHistoryLoading")
                : t("game.final.exportHistory")}
            </button>
            {isGameEnded && (
              <button
                onClick={onOpenSavedHistory}
                data-testid="open-saved-history-button"
                className="rounded-full border border-amber-300/55 bg-amber-900/30 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-800/40"
              >
                {t("game.final.openSavedHistory")}
              </button>
            )}
            <button
              onClick={onSaveScreenshot}
              data-testid="save-final-summary-screenshot-button"
              className="rounded-full border border-cyan-300/55 bg-cyan-900/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/40"
            >
              {t("game.final.saveScreenshot")}
            </button>
            {isGameEnded ? (
              <button
                onClick={onLeave}
                data-testid="leave-from-final-summary-button"
                className="rounded-lg border border-rose-400/70 bg-rose-900/30 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-rose-100 transition hover:bg-rose-800/40"
              >
                {t("common.leave")}
              </button>
            ) : (
              <button
                onClick={onClose}
                data-testid="close-final-summary-button"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                {t("common.close")}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 min-[520px]:grid-cols-2 xl:grid-cols-3">
          {finalSummaryCards.map((card) => (
            <article
              key={card.key}
              className="rounded-xl border border-emerald-700/70 bg-emerald-950/55 p-3"
            >
              <p className="text-xs uppercase tracking-wide text-emerald-100/70">{card.label}</p>
              <p className="mt-1 text-sm font-semibold text-white">{card.value}</p>
            </article>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 min-[520px]:grid-cols-2">
          <article className="rounded-xl border border-emerald-700/70 bg-emerald-950/55 p-3">
            <p className="text-xs uppercase tracking-wide text-emerald-100/70">
              {t("game.final.chipLeader")}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {finalGameResult.summary.chipLeader
                ? `${finalGameResult.summary.chipLeader.playerName} ($${finalGameResult.summary.chipLeader.amount})`
                : t("game.final.none")}
            </p>
          </article>
          <article className="rounded-xl border border-emerald-700/70 bg-emerald-950/55 p-3">
            <p className="text-xs uppercase tracking-wide text-emerald-100/70">
              {t("game.final.biggestSwing")}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {finalGameResult.summary.biggestWinner
                ? `${t("game.final.biggestWinner")}: ${finalGameResult.summary.biggestWinner.playerName} (+$${finalGameResult.summary.biggestWinner.amount})`
                : `${t("game.final.biggestWinner")}: ${t("game.final.none")}`}
            </p>
            <p className="mt-1 text-xs text-emerald-100/80">
              {finalGameResult.summary.biggestLoss
                ? `${t("game.final.biggestLoss")}: ${finalGameResult.summary.biggestLoss.playerName} (-$${finalGameResult.summary.biggestLoss.amount})`
                : `${t("game.final.biggestLoss")}: ${t("game.final.none")}`}
            </p>
          </article>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-emerald-700/60">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-950/70 text-emerald-100/70">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.rank")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.player")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("game.final.finalChips")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.buyIn")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.handsWon")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.vpipHands")}</th>
                <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.net")}</th>
              </tr>
            </thead>
            <tbody className="bg-emerald-950/45">
              {finalStandings.map((entry) => {
                const isSelf = entry.playerId === currentPlayerId;
                return (
                  <tr
                    key={entry.playerId}
                    className="border-t border-emerald-800/60 text-emerald-50"
                    data-testid={`final-ranking-row-${entry.rankOrder}`}
                  >
                    <td className="px-3 py-2">#{entry.rankOrder}</td>
                    <td className="px-3 py-2">
                      {entry.playerName}
                      {isSelf ? ` (${t("common.you")})` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">${entry.finalChips}</td>
                    <td className="px-3 py-2 text-right">${entry.totalBuyIn}</td>
                    <td className="px-3 py-2 text-right">{entry.handsWonCount ?? 0}</td>
                    <td className="px-3 py-2 text-right">{entry.vpipHandsCount ?? 0}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        entry.profit >= 0 ? "text-emerald-300" : "text-red-300"
                      }`}
                    >
                      {entry.profit >= 0 ? "+" : ""}${entry.profit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  ),
);

FinalSummaryModal.displayName = "FinalSummaryModal";
