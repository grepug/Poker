import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Card as PokerCard, HandEvaluation } from "poker-types";
import { HandResultsContent } from "./hand-results-content";
import { storyTranslate } from "./storybook-fixtures";

const communityCards: Array<PokerCard | null> = [
  { rank: "A", suit: "spades" },
  { rank: "Q", suit: "spades" },
  { rank: "J", suit: "spades" },
  { rank: "10", suit: "spades" },
  { rank: "2", suit: "hearts" },
];

const shownHand: HandEvaluation = {
  rank: "STRAIGHT_FLUSH",
  value: 10,
  cards: [
    { rank: "A", suit: "spades" },
    { rank: "K", suit: "spades" },
    { rank: "Q", suit: "spades" },
    { rank: "J", suit: "spades" },
    { rank: "10", suit: "spades" },
  ],
  description: "Straight Flush, A high",
};

const renderHandResultsContent = () =>
  renderToStaticMarkup(
    React.createElement(HandResultsContent, {
      currentHandNumber: 22,
      totalPot: 480,
      winnerCount: 1,
      myNetChange: 240,
      showNetChange: true,
      currentPlayerId: "p1",
      communityCards,
      payoutBreakdownRows: [],
      handResultRows: [
        {
          playerId: "p1",
          playerName: "Kai",
          rankOrder: 1,
          isWinner: true,
          amountWon: 360,
          netChange: 240,
          cards: [
            { rank: "K", suit: "spades" },
            { rank: "9", suit: "spades" },
          ],
          hand: shownHand,
          resultStatus: "shown",
          cardsVisibility: "shown",
          seatPosition: 0,
        },
        {
          playerId: "p2",
          playerName: "Maya",
          rankOrder: 2,
          isWinner: false,
          amountWon: 0,
          netChange: -120,
          cards: [],
          hand: null,
          resultStatus: "hidden_contender",
          cardsVisibility: "hidden",
          seatPosition: 1,
        },
        {
          playerId: "p3",
          playerName: "Noah",
          rankOrder: 3,
          isWinner: false,
          amountWon: 0,
          netChange: -120,
          cards: [],
          hand: null,
          resultStatus: "folded_at_showdown",
          cardsVisibility: "hidden",
          seatPosition: 2,
        },
      ],
      revealedHandPlayerIdSet: new Set(["p1"]),
      onSaveResultScreenshot: () => {},
      onExportHandHistory: () => {},
      isExportingHandHistory: false,
      onOpenHandReview: () => {},
      isOpeningHandReview: false,
      handReviewUnavailableSummary: null,
      describeEvaluatedHand: (hand: HandEvaluation) => hand.description,
      t: storyTranslate,
    }),
  );

describe("HandResultsContent", () => {
  it("omits hidden card placeholders and redundant hidden-hand copy for unrevealed rows", () => {
    const html = renderHandResultsContent();

    expect(html).toContain('data-testid="hand-result-card-p1-0"');
    expect(html).toContain("Straight Flush, A high");
    expect(html).not.toContain("hand-result-hidden-card-p2-0");
    expect(html).not.toContain("hand-result-hidden-card-p3-0");
    expect(html).not.toContain('data-testid="hand-result-rank-p2"');
    expect(html).not.toContain('data-testid="hand-result-rank-p3"');
    expect(html).not.toContain("game.handHidden");
  });
});
