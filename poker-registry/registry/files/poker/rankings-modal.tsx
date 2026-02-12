import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type PlayerRanking = {
  id: string;
  name: string;
  tableStack: number;
  totalBuyIn: number;
  net: number;
};

type RankingsModalProps = {
  playerRankings: PlayerRanking[];
  currentPlayerId: string;
  onClose: () => void;
  t: Translate;
};

export const RankingsModal: React.FC<RankingsModalProps> = ({
  playerRankings,
  currentPlayerId,
  onClose,
  t,
}) => (
  <div
    className="fixed inset-0 z-[75] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
    data-testid="rankings-modal"
  >
    <div className="surface-panel w-full max-w-2xl p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-black text-white">{t("game.rankings.title")}</h3>
        <button
          onClick={onClose}
          data-testid="close-rankings-button"
          className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
        >
          {t("common.close")}
        </button>
      </div>
      <p className="mt-1 text-sm text-emerald-100/80">{t("game.rankings.sortedBy")}</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-700/60">
        <table className="min-w-full text-sm">
          <thead className="bg-emerald-950/70 text-emerald-100/70">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.rank")}</th>
              <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.player")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.stack")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.buyIn")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.net")}</th>
            </tr>
          </thead>
          <tbody className="bg-emerald-950/45">
            {playerRankings.map((rankedPlayer, idx) => (
              <tr
                key={rankedPlayer.id}
                className="border-t border-emerald-800/60 text-emerald-50"
                data-testid={`ranking-row-${idx + 1}`}
              >
                <td className="px-3 py-2">#{idx + 1}</td>
                <td className="px-3 py-2">
                  {rankedPlayer.name}
                  {rankedPlayer.id === currentPlayerId ? ` (${t("common.you")})` : ""}
                </td>
                <td className="px-3 py-2 text-right">${rankedPlayer.tableStack}</td>
                <td className="px-3 py-2 text-right">${rankedPlayer.totalBuyIn}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    rankedPlayer.net >= 0 ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {rankedPlayer.net >= 0 ? "+" : ""}${rankedPlayer.net}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);
