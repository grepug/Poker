import React from "react";
import type { Card as PokerCard, HandEvaluation } from "poker-types";
import type { MessageKey } from "@/i18n/messages";
import { Card } from "@/components/Card";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type PayoutBreakdownRow = {
  segmentIndex: number;
  label: string;
  amount: number;
  uncontested: boolean;
  winnerShares: Array<{
    playerId: string;
    playerName: string;
    amountWon: number;
  }>;
};

type HandResultRow = {
  playerId: string;
  playerName: string;
  rankOrder: number;
  isWinner: boolean;
  amountWon: number;
  netChange: number;
  cards: PokerCard[];
  hand: HandEvaluation | null;
};

type HandResultsContentProps = {
  currentHandNumber: number | null;
  totalPot: number;
  winnerCount: number;
  myNetChange: number | null;
  currentPlayerId: string;
  communityCards: Array<PokerCard | null>;
  payoutBreakdownRows: PayoutBreakdownRow[];
  handResultRows: HandResultRow[];
  revealedHandPlayerIdSet: Set<string>;
  onSaveResultScreenshot: () => void;
  describeEvaluatedHand: (hand: HandEvaluation) => string;
  t: Translate;
};

export const HandResultsContent: React.FC<HandResultsContentProps> = ({
  currentHandNumber,
  totalPot,
  winnerCount: _winnerCount,
  myNetChange,
  currentPlayerId,
  communityCards,
  payoutBreakdownRows,
  handResultRows,
  revealedHandPlayerIdSet,
  onSaveResultScreenshot,
  describeEvaluatedHand,
  t,
}) => {
  const formatNet = (amount: number) => `${amount >= 0 ? "+" : "-"}$${Math.abs(amount)}`;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-emerald-100" data-testid="hand-results-title">
            {t("game.handResults", { handNumber: currentHandNumber ?? "?" })}
          </h3>
          <p className="mt-1 text-xs text-emerald-100/75" data-testid="hand-results-mode">
            {t("game.showdownComplete")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="hud-chip" data-testid="hand-results-pot">
            {t("game.pot", { amount: totalPot })}
          </span>
          <span className="sr-only" data-testid="hand-results-winner-count">
            {t("game.winnersCount", { count: _winnerCount })}
          </span>
          {myNetChange !== null && (
            <span
              className={`hud-chip ${
                myNetChange > 0
                  ? "border-emerald-300/70 text-emerald-100"
                  : myNetChange < 0
                    ? "border-rose-300/70 text-rose-100"
                    : ""
              }`}
              data-testid="hand-results-your-net"
            >
              {t("game.yourHandNet", { amount: formatNet(myNetChange) })}
            </span>
          )}
          <button
            onClick={onSaveResultScreenshot}
            data-testid="save-result-screenshot-button"
            className="rounded-full border border-cyan-300/55 bg-cyan-900/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/40"
          >
            {t("game.saveResultScreenshot")}
          </button>
        </div>
      </div>

      <div
        className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3"
        data-testid="hand-results-community"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
          {t("game.communityCards")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm text-emerald-50">
          {communityCards.map((card, idx) => (
            <Card
              key={`hand-results-community-card-${idx}-${card ? `${card.suit}-${card.rank}` : "back"}`}
              card={card}
              size="small"
              faceDown={!card}
              dataTestId={card ? `hand-results-community-card-${idx}` : `hand-results-community-back-${idx}`}
            />
          ))}
        </div>
      </div>

      {payoutBreakdownRows.length > 0 && (
        <div
          className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3"
          data-testid="hand-results-payouts"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
            {t("game.payoutBreakdown")}
          </p>
          <div className="mt-2 space-y-2">
            {payoutBreakdownRows.map((segment) => (
              <div
                key={`payout-segment-${segment.segmentIndex}`}
                className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 px-3 py-2"
                data-testid={`payout-segment-${segment.segmentIndex}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-50">{segment.label}</span>
                    {segment.uncontested && (
                      <span className="rounded-full border border-amber-300/70 bg-amber-300/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                        {t("game.payout.uncontested")}
                      </span>
                    )}
                  </div>
                  <span className="rounded-full border border-emerald-500/60 bg-emerald-700/30 px-2 py-1 text-xs font-semibold text-emerald-50">
                    ${segment.amount}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {segment.winnerShares.map((share) => (
                    <span
                      key={`payout-share-${segment.segmentIndex}-${share.playerId}`}
                      className="rounded-full border border-cyan-400/60 bg-cyan-900/35 px-2 py-1 text-xs font-semibold text-cyan-100"
                      data-testid={`payout-share-${segment.segmentIndex}-${share.playerId}`}
                    >
                      {share.playerName}
                      {share.playerId === currentPlayerId ? ` (${t("common.you")})` : ""} +$
                      {share.amountWon}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {handResultRows.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3" data-testid="hand-results-rows">
          {handResultRows.map((entry) => {
            const isSelf = entry.playerId === currentPlayerId;
            const showCards = revealedHandPlayerIdSet.has(entry.playerId);

            return (
              <article
                key={`hand-result-${entry.playerId}`}
                className={`rounded-xl border p-3 ${
                  entry.isWinner
                    ? "border-amber-400/70 bg-amber-500/10"
                    : "border-emerald-700/60 bg-emerald-950/45"
                }`}
                data-testid={`hand-result-row-${entry.playerId}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      #{entry.rankOrder} {entry.playerName}
                      {isSelf ? ` (${t("common.you")})` : ""}
                    </p>
                    <p className="text-xs text-emerald-100/70">
                      {t("game.netChange", { amount: formatNet(entry.netChange) })}
                    </p>
                  </div>
                  {entry.isWinner && (
                    <span className="rounded-full border border-amber-300/70 bg-amber-300/20 px-2 py-1 text-xs font-semibold text-amber-100">
                      {t("game.winner")}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {showCards
                    ? entry.cards.map((card, idx) => (
                        <Card
                          key={`${entry.playerId}-shown-${idx}`}
                          card={card}
                          size="small"
                          dataTestId={`hand-result-card-${entry.playerId}-${idx}`}
                        />
                      ))
                    : [0, 1].map((idx) => (
                        <Card
                          key={`${entry.playerId}-hidden-${idx}`}
                          card={null}
                          size="small"
                          faceDown
                          dataTestId={`hand-result-hidden-card-${entry.playerId}-${idx}`}
                        />
                      ))}
                </div>

                <p
                  className="mt-2 text-xs text-emerald-100/75"
                  data-testid={`hand-result-rank-${entry.playerId}`}
                >
                  {showCards
                    ? entry.hand
                      ? describeEvaluatedHand(entry.hand)
                      : t("game.cardsShownNoEvaluated")
                    : t("game.handHidden")}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
};
