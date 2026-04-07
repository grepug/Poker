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
  netChange: number | null;
  cards: PokerCard[];
  hand: HandEvaluation | null;
  resultStatus: "shown" | "folded_pre_showdown" | "folded_at_showdown" | "hidden_contender";
  cardsVisibility: "shown" | "hidden";
  seatPosition: number;
  runHands?: Array<{
    runIndex: number;
    hand: HandEvaluation | null;
  }>;
};

type HandResultsContentProps = {
  currentHandNumber: number | null;
  totalPot: number;
  winnerCount: number;
  myNetChange: number | null;
  showNetChange: boolean;
  currentPlayerId: string;
  communityCards: Array<PokerCard | null>;
  runouts?: Array<{
    runIndex: number;
    board: PokerCard[];
    winners: Array<{
      playerId: string;
      playerName: string;
      amountWon: number;
    }>;
  }>;
  payoutBreakdownRows: PayoutBreakdownRow[];
  handResultRows: HandResultRow[];
  revealedHandPlayerIdSet: Set<string>;
  onSaveResultScreenshot: () => void;
  describeEvaluatedHand: (hand: HandEvaluation) => string;
  t: Translate;
};

const HAND_RESULT_COMMUNITY_SLOT_META = [
  { id: "flop-1", position: 0, revealedTestId: "hand-results-community-card-0", hiddenTestId: "hand-results-community-back-0" },
  {
    id: "flop-2",
    position: 1,
    revealedTestId: "hand-results-community-card-1",
    hiddenTestId: "hand-results-community-back-1",
  },
  {
    id: "flop-3",
    position: 2,
    revealedTestId: "hand-results-community-card-2",
    hiddenTestId: "hand-results-community-back-2",
  },
  {
    id: "turn",
    position: 3,
    revealedTestId: "hand-results-community-card-3",
    hiddenTestId: "hand-results-community-back-3",
  },
  {
    id: "river",
    position: 4,
    revealedTestId: "hand-results-community-card-4",
    hiddenTestId: "hand-results-community-back-4",
  },
] as const;
const HIDDEN_HOLE_CARD_META = [
  { id: "left", testIndex: 0 },
  { id: "right", testIndex: 1 },
] as const;

export const HandResultsContent: React.FC<HandResultsContentProps> = ({
  currentHandNumber,
  totalPot,
  winnerCount: _winnerCount,
  myNetChange,
  showNetChange,
  currentPlayerId,
  communityCards,
  runouts,
  payoutBreakdownRows,
  handResultRows,
  revealedHandPlayerIdSet,
  onSaveResultScreenshot,
  describeEvaluatedHand,
  t,
}) => {
  const formatNet = (amount: number) => `${amount >= 0 ? "+" : "-"}$${Math.abs(amount)}`;
  const getResultStatusLabel = (
    resultStatus: HandResultRow["resultStatus"],
  ): string => {
    if (resultStatus === "shown") {
      return t("game.resultStatus.shown");
    }
    if (resultStatus === "folded_pre_showdown" || resultStatus === "folded_at_showdown") {
      return t("game.resultStatus.folded");
    }
    return t("game.resultStatus.hidden");
  };

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
          {HAND_RESULT_COMMUNITY_SLOT_META.map((slotMeta) => {
            const card = communityCards[slotMeta.position] ?? null;
            return (
              <Card
                key={`hand-results-community-card-${slotMeta.id}-${card ? `${card.suit}-${card.rank}` : "back"}`}
                card={card}
                size="small"
                faceDown={!card}
                dataTestId={card ? slotMeta.revealedTestId : slotMeta.hiddenTestId}
              />
            );
          })}
        </div>
      </div>

      {runouts && runouts.length > 1 && (
        <div
          className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3"
          data-testid="hand-results-runouts"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
            {t("game.runouts.title")}
          </p>
          <div className="mt-2 grid gap-3">
            {runouts.map((runout) => (
              <div
                key={`hand-result-runout-${runout.runIndex}`}
                className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 px-3 py-3"
                data-testid={`hand-result-runout-${runout.runIndex}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-emerald-50">
                    {t("game.runouts.runLabel", { index: runout.runIndex + 1 })}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {runout.winners.map((winner) => (
                      <span
                        key={`hand-result-runout-winner-${runout.runIndex}-${winner.playerId}`}
                        className="rounded-full border border-cyan-400/60 bg-cyan-900/35 px-2 py-1 text-xs font-semibold text-cyan-100"
                        data-testid={`hand-result-runout-winner-${runout.runIndex}-${winner.playerId}`}
                      >
                        {winner.playerName}
                        {winner.playerId === currentPlayerId ? ` (${t("common.you")})` : ""} +$
                        {winner.amountWon}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {runout.board.map((card, cardIndex) => (
                    <Card
                      key={`hand-result-runout-card-${runout.runIndex}-${card.suit}-${card.rank}-${cardIndex}`}
                      card={card}
                      size="small"
                      dataTestId={`hand-result-runout-card-${runout.runIndex}-${cardIndex}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            const showCards =
              entry.cardsVisibility === "shown" || revealedHandPlayerIdSet.has(entry.playerId);
            const resultStatusLabel = showCards
              ? t("game.resultStatus.shown")
              : getResultStatusLabel(entry.resultStatus);
            const isFoldedResultStatus =
              entry.resultStatus === "folded_pre_showdown" ||
              entry.resultStatus === "folded_at_showdown";

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
                    <p className="text-xs text-emerald-100/70" data-testid={`hand-result-status-${entry.playerId}`}>
                      {resultStatusLabel}
                    </p>
                    <p className="text-xs text-emerald-100/70">
                      {showNetChange && typeof entry.netChange === "number"
                        ? t("game.netChange", { amount: formatNet(entry.netChange) })
                        : entry.isWinner
                          ? t("game.wonAmount", { amount: entry.amountWon })
                          : t("game.noPayout")}
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
                          key={`${entry.playerId}-shown-${card.suit}-${card.rank}`}
                          card={card}
                          size="small"
                          dataTestId={`hand-result-card-${entry.playerId}-${idx}`}
                        />
                      ))
                    : HIDDEN_HOLE_CARD_META.map((slotMeta) => (
                        <Card
                          key={`${entry.playerId}-hidden-${slotMeta.id}`}
                          card={null}
                          size="small"
                          faceDown
                          dataTestId={`hand-result-hidden-card-${entry.playerId}-${slotMeta.testIndex}`}
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
                    : isFoldedResultStatus
                      ? `${t("game.resultStatus.folded")} · ${t("game.handHidden")}`
                      : t("game.handHidden")}
                </p>
                {showCards && entry.runHands && entry.runHands.length > 1 && (
                  <div
                    className="mt-2 flex flex-wrap gap-2 text-[11px] text-emerald-100/75"
                    data-testid={`hand-result-run-hands-${entry.playerId}`}
                  >
                    {entry.runHands.map((runHand) => (
                      <span
                        key={`hand-result-run-hand-${entry.playerId}-${runHand.runIndex}`}
                        className="rounded-full border border-emerald-700/60 bg-emerald-900/30 px-2 py-1"
                      >
                        {`${t("game.runouts.runLabel", { index: runHand.runIndex + 1 })}: ${
                          runHand.hand
                            ? describeEvaluatedHand(runHand.hand)
                            : t("game.cardsShownNoEvaluated")
                        }`}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
};
