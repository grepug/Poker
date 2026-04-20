import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageKey, Locale } from "@/i18n/messages";
import {
  SavedGameDetailShell,
  SavedGameDetailView,
  shouldLoadSelectedHandDetail,
} from "./SavedGameDetail";

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

const buildSummaryOnlyDetail = () => {
  const detail = buildDetail();
  return {
    ...detail,
    hands: detail.hands.map((hand) => ({
      handNumber: hand.handNumber,
      totalPot: hand.history.settlement.totalPot,
      actionCount: hand.history.actions.length,
      analysis: hand.analysis,
    })),
  };
};

const t = (key: MessageKey, values?: Record<string, string | number>) => {
  if (!values) {
    return key;
  }

  return `${key}:${JSON.stringify(values)}`;
};

const renderView = () =>
  (() => {
    const detail = buildDetail();
    return renderToStaticMarkup(
      React.createElement(SavedGameDetailView, {
        detail,
        selectedHand: detail.hands[0],
        selectedHandLoadError: null,
        selectedHandNumber: 1,
        locale: "en" satisfies Locale,
        localeTag: "en-US",
        t,
        onBackToHistory: vi.fn(),
        onBackToLobby: vi.fn(),
        onSelectHandNumber: vi.fn(),
      }),
    );
  })();

const renderSummaryOnlyView = () => {
  const detail = buildDetail();
  return renderToStaticMarkup(
    React.createElement(SavedGameDetailView as any, {
      detail: buildSummaryOnlyDetail(),
      selectedHand: detail.hands[0],
      selectedHandLoadError: null,
      selectedHandNumber: 1,
      locale: "en" satisfies Locale,
      localeTag: "en-US",
      t,
      onBackToHistory: vi.fn(),
      onBackToLobby: vi.fn(),
      onSelectHandNumber: vi.fn(),
    }),
  );
};

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

  it("renders the desktop standings buy-in column from archived participant totals", () => {
    const html = renderView();
    const standingsSectionStart = html.indexOf(
      'data-testid="saved-history-desktop-standings"',
    );
    const desktopHandListStart = html.indexOf(
      'data-testid="saved-history-desktop-hand-list"',
    );
    const standingsSection = html.slice(
      standingsSectionStart,
      desktopHandListStart,
    );

    expect(standingsSectionStart).toBeGreaterThanOrEqual(0);
    expect(desktopHandListStart).toBeGreaterThan(standingsSectionStart);
    expect(standingsSection).toContain("game.rankings.buyIn");
    expect(standingsSection).toContain("$1000");
  });

  it("renders selected-hand detail from a separately loaded hand while the archive hand list stays summary-only", () => {
    const html = renderSummaryOnlyView();

    expect(html).toContain("history.handLabel:{&quot;handNumber&quot;:1}");
    expect(html).toContain("history.handPot:{&quot;amount&quot;:80}");
    expect(html).toContain("history.handPot:{&quot;amount&quot;:15}");
  });

  it("keeps the archive shell visible when the selected hand fails to load", () => {
    const html = renderToStaticMarkup(
      React.createElement(SavedGameDetailView as any, {
        detail: buildSummaryOnlyDetail(),
        selectedHand: null,
        selectedHandLoadError: "Saved hand unavailable",
        selectedHandNumber: 2,
        locale: "en" satisfies Locale,
        localeTag: "en-US",
        t,
        onBackToHistory: vi.fn(),
        onBackToLobby: vi.fn(),
        onSelectHandNumber: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="saved-history-mobile-hand-strip"');
    expect(html).toContain('data-testid="saved-history-desktop-hand-list"');
    expect(html).toContain("Saved hand unavailable");
  });

  it("renders a retry review action for failed selected-hand analysis", () => {
    const detail = buildDetail();
    const failedHand = {
      ...detail.hands[0],
      analysis: {
        status: "failed" as const,
        updatedAt: 1_710_000_950_000,
        headline: null,
        summary: null,
        keyAdjustments: [],
        failureReason: "Insufficient credits",
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(SavedGameDetailView as any, {
        detail: {
          ...detail,
          hands: [
            {
              handNumber: failedHand.handNumber,
              totalPot: failedHand.history.settlement.totalPot,
              actionCount: failedHand.history.actions.length,
              analysis: failedHand.analysis,
            },
            detail.hands[1],
          ],
        },
        selectedHand: failedHand,
        selectedHandLoadError: null,
        selectedHandNumber: 1,
        locale: "en" satisfies Locale,
        localeTag: "en-US",
        t,
        onBackToHistory: vi.fn(),
        onBackToLobby: vi.fn(),
        onSelectHandNumber: vi.fn(),
        onRetrySelectedHandAnalysis: vi.fn(),
        retryActionLabelKey: "history.retryReview",
        isRetryingSelectedHandAnalysis: false,
      }),
    );

    expect(html).toContain('data-testid="saved-history-retry-analysis-button"');
    expect(html).toContain("history.retryReview");
    expect(html).toContain("Insufficient credits");
  });

  it("renders a retry review action for unavailable selected-hand analysis", () => {
    const detail = buildDetail();
    const unavailableHand = {
      ...detail.hands[0],
      analysis: {
        status: "unavailable" as const,
        updatedAt: 1_710_000_955_000,
        headline: null,
        summary: null,
        keyAdjustments: [],
        failureReason: "Missing AI provider configuration",
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(SavedGameDetailView as any, {
        detail: {
          ...detail,
          hands: [
            {
              handNumber: unavailableHand.handNumber,
              totalPot: unavailableHand.history.settlement.totalPot,
              actionCount: unavailableHand.history.actions.length,
              analysis: unavailableHand.analysis,
            },
            detail.hands[1],
          ],
        },
        selectedHand: unavailableHand,
        selectedHandLoadError: null,
        selectedHandNumber: 1,
        locale: "en" satisfies Locale,
        localeTag: "en-US",
        t,
        onBackToHistory: vi.fn(),
        onBackToLobby: vi.fn(),
        onSelectHandNumber: vi.fn(),
        onRetrySelectedHandAnalysis: vi.fn(),
        retryActionLabelKey: "history.retryReview",
        isRetryingSelectedHandAnalysis: false,
      }),
    );

    expect(html).toContain('data-testid="saved-history-retry-analysis-button"');
    expect(html).toContain("history.retryReview");
    expect(html).toContain("Missing AI provider configuration");
  });

  it("renders a disabled retry translation action while retry is in flight", () => {
    const detail = buildDetail();
    const localizedFailureHand = {
      ...detail.hands[0],
      analysis: {
        ...detail.hands[0].analysis,
        localizedByLocale: {
          en: detail.hands[0].analysis.localizedByLocale?.en,
          zh_hans: {
            status: "failed" as const,
            updatedAt: 1_710_000_960_000,
            headline: null,
            summary: null,
            keyAdjustments: [],
            failureReason: "Insufficient credits",
          },
        },
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(SavedGameDetailView as any, {
        detail: {
          ...detail,
          hands: [
            {
              handNumber: localizedFailureHand.handNumber,
              totalPot: localizedFailureHand.history.settlement.totalPot,
              actionCount: localizedFailureHand.history.actions.length,
              analysis: localizedFailureHand.analysis,
            },
            detail.hands[1],
          ],
        },
        selectedHand: localizedFailureHand,
        selectedHandLoadError: null,
        selectedHandNumber: 1,
        locale: "zh_hans" satisfies Locale,
        localeTag: "zh-Hans-CN",
        t,
        onBackToHistory: vi.fn(),
        onBackToLobby: vi.fn(),
        onSelectHandNumber: vi.fn(),
        onRetrySelectedHandAnalysis: vi.fn(),
        retryActionLabelKey: "history.retryTranslation",
        isRetryingSelectedHandAnalysis: true,
      }),
    );

    expect(html).toContain("history.retryingReview");
    expect(html).toContain('disabled=""');
  });
});

describe("shouldLoadSelectedHandDetail", () => {
  it("waits for the current archive summary and ignores stale or cached selections", () => {
    const detail = buildSummaryOnlyDetail();

    expect(
      shouldLoadSelectedHandDetail({
        archiveId: detail.archiveId,
        detail,
        selectedHandNumber: 1,
        handDetailsByNumber: {},
      }),
    ).toBe(true);
    expect(
      shouldLoadSelectedHandDetail({
        archiveId: "NEXT",
        detail,
        selectedHandNumber: 1,
        handDetailsByNumber: {},
      }),
    ).toBe(false);
    expect(
      shouldLoadSelectedHandDetail({
        archiveId: detail.archiveId,
        detail,
        selectedHandNumber: 999,
        handDetailsByNumber: {},
      }),
    ).toBe(false);
    expect(
      shouldLoadSelectedHandDetail({
        archiveId: detail.archiveId,
        detail,
        selectedHandNumber: 1,
        handDetailsByNumber: {
          1: buildDetail().hands[0],
        },
      }),
    ).toBe(false);
  });
});
