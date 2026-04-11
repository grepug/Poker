import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageKey, Locale } from "@/i18n/messages";
import { SavedGameDetailShell, SavedGameDetailView } from "./SavedGameDetail";

const buildDetail = () => ({
  archiveId: "G5V69T",
  roomId: "G5V69T",
  requesterUserId: "user-1",
  requesterPlayerId: "player-1",
  createdAt: 1_710_000_000_000,
  startedAt: 1_710_000_100_000,
  concludedAt: 1_710_000_900_000,
  handCount: 2,
  blinds: {
    smallBlind: 5,
    bigBlind: 10,
  },
  participants: [
    {
      playerId: "player-1",
      userId: "user-1",
      playerName: "test1",
      avatarEmoji: "🦊",
      isRobot: false,
      finalChips: 1730,
      totalBuyIn: 1000,
      profit: 730,
      handsPlayedCount: 2,
      handsWonCount: 2,
      vpipHandsCount: 1,
      vpipRate: 0.5,
    },
    {
      playerId: "robot-1",
      userId: null,
      playerName: "Robot 1",
      avatarEmoji: "🤖",
      isRobot: true,
      finalChips: 240,
      totalBuyIn: 1000,
      profit: -760,
      handsPlayedCount: 2,
      handsWonCount: 0,
      vpipHandsCount: 1,
      vpipRate: 0.5,
    },
  ],
  hands: [
    {
      handNumber: 1,
      history: {
        version: 1 as const,
        roomId: "G5V69T",
        handNumber: 1,
        requesterPlayerId: "player-1",
        dealerPosition: 1,
        smallBlindPosition: 1,
        bigBlindPosition: 2,
        blinds: {
          smallBlind: 5,
          bigBlind: 10,
        },
        communityCardsByStreet: {
          preFlop: [],
          flop: [
            { rank: "Q", suit: "hearts" as const },
            { rank: "Q", suit: "clubs" as const },
            { rank: "A", suit: "clubs" as const },
          ],
          turn: [{ rank: "8", suit: "hearts" as const }],
          river: [{ rank: "Q", suit: "spades" as const }],
        },
        seats: [
          {
            playerId: "player-1",
            playerName: "test1",
            seatPosition: 1,
            positionLabel: "SB" as const,
            startingStack: 1000,
            holeCards: [
              { rank: "Q", suit: "spades" as const },
              { rank: "J", suit: "spades" as const },
            ],
            holeCardsVisibility: "self" as const,
          },
          {
            playerId: "robot-1",
            playerName: "Robot 1",
            seatPosition: 2,
            positionLabel: "BB" as const,
            startingStack: 1000,
            holeCards: null,
            holeCardsVisibility: "hidden" as const,
          },
        ],
        actions: [
          {
            order: 1,
            source: "blind" as const,
            street: "preflop" as const,
            playerId: "player-1",
            playerName: "test1",
            action: "post-blind" as const,
            amount: 5,
            potAfter: 5,
            blindType: "small-blind" as const,
          },
          {
            order: 2,
            source: "blind" as const,
            street: "preflop" as const,
            playerId: "robot-1",
            playerName: "Robot 1",
            action: "post-blind" as const,
            amount: 10,
            potAfter: 15,
            blindType: "big-blind" as const,
          },
          {
            order: 3,
            source: "player" as const,
            street: "preflop" as const,
            playerId: "player-1",
            playerName: "test1",
            action: "raise",
            amount: 30,
            potAfter: 45,
          },
        ],
        settlement: {
          isShowdown: true,
          revealedPlayerIds: ["player-1"],
          totalPot: 80,
          payouts: [],
          winners: [
            {
              playerId: "player-1",
              playerName: "test1",
              hand: null,
              amountWon: 80,
            },
          ],
          netByPlayerId: {
            "player-1": 80,
            "robot-1": -80,
          },
        },
      },
      analysis: {
        status: "ready" as const,
        updatedAt: 1_710_000_950_000,
        headline: "Fast-played trips",
        summary: "The value line captured the full stack on the river.",
        keyAdjustments: ["Keep value sizing large on paired boards."],
        localizedByLocale: {
          en: {
            status: "ready" as const,
            updatedAt: 1_710_000_950_000,
            headline: "Fast-played trips",
            summary: "The value line captured the full stack on the river.",
            keyAdjustments: ["Keep value sizing large on paired boards."],
          },
        },
      },
    },
    {
      handNumber: 2,
      history: {
        version: 1 as const,
        roomId: "G5V69T",
        handNumber: 2,
        requesterPlayerId: "player-1",
        dealerPosition: 2,
        smallBlindPosition: 2,
        bigBlindPosition: 1,
        blinds: {
          smallBlind: 5,
          bigBlind: 10,
        },
        communityCardsByStreet: {
          preFlop: [],
          flop: [],
          turn: [],
          river: [],
        },
        seats: [
          {
            playerId: "player-1",
            playerName: "test1",
            seatPosition: 1,
            positionLabel: "BB" as const,
            startingStack: 1080,
            holeCards: null,
            holeCardsVisibility: "hidden" as const,
          },
          {
            playerId: "robot-1",
            playerName: "Robot 1",
            seatPosition: 2,
            positionLabel: "SB" as const,
            startingStack: 920,
            holeCards: null,
            holeCardsVisibility: "hidden" as const,
          },
        ],
        actions: [
          {
            order: 1,
            source: "blind" as const,
            street: "preflop" as const,
            playerId: "robot-1",
            playerName: "Robot 1",
            action: "post-blind" as const,
            amount: 5,
            potAfter: 5,
            blindType: "small-blind" as const,
          },
        ],
        settlement: {
          isShowdown: false,
          revealedPlayerIds: [],
          totalPot: 15,
          payouts: [],
          winners: [],
          netByPlayerId: {
            "player-1": -10,
            "robot-1": 10,
          },
        },
      },
      analysis: {
        status: "pending" as const,
        updatedAt: 1_710_001_000_000,
      },
    },
  ],
});

const t = (key: MessageKey, values?: Record<string, string | number>) => {
  if (!values) {
    return key;
  }

  return `${key}:${JSON.stringify(values)}`;
};

const renderView = () =>
  renderToStaticMarkup(
    React.createElement(SavedGameDetailView, {
      detail: buildDetail(),
      selectedHandNumber: 1,
      locale: "en" satisfies Locale,
      localeTag: "en-US",
      t,
      onBackToHistory: vi.fn(),
      onBackToLobby: vi.fn(),
      onSelectHandNumber: vi.fn(),
    }),
  );

describe("SavedGameDetailView", () => {
  it("keeps history and lobby navigation visible in shell states like loading or error", () => {
    const html = renderToStaticMarkup(
      React.createElement(SavedGameDetailShell, {
        title: "Saved Game",
        onBackToHistory: vi.fn(),
        onBackToLobby: vi.fn(),
        t,
        children: React.createElement("div", null, "Placeholder state"),
      }),
    );

    expect(html).toContain("history.backToHistory");
    expect(html).toContain("history.backToLobby");
    expect(html).toContain("Placeholder state");
  });

  it("puts the mobile hand switcher before the selected-hand detail and exposes mobile section tabs", () => {
    const html = renderView();

    const handStripIndex = html.indexOf('data-testid="saved-history-mobile-hand-strip"');
    const detailIndex = html.indexOf('data-testid="saved-history-mobile-selected-hand"');

    expect(handStripIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(handStripIndex);
    expect(html).toContain('data-testid="saved-history-mobile-section-tabs"');
    expect(html).toContain('data-testid="saved-history-mobile-tab-overview"');
    expect(html).toContain('data-testid="saved-history-mobile-tab-actions"');
    expect(html).toContain('data-testid="saved-history-mobile-tab-review"');
    expect(html).toContain('data-testid="saved-history-mobile-tab-session"');
    expect(html).toContain('data-testid="saved-history-mobile-tab-overview" aria-pressed="true"');
    expect(html).toContain('data-testid="saved-history-mobile-tab-actions" aria-pressed="false"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("keeps dedicated desktop standings and hand list regions while mobile gets its own supporting sections", () => {
    const html = renderView();

    expect(html).toContain('data-testid="saved-history-desktop-standings"');
    expect(html).toContain('data-testid="saved-history-desktop-hand-list"');
    expect(html).toContain('data-testid="saved-history-mobile-overview-panel"');
  });
});
