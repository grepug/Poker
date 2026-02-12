import type { GameEndedData } from "poker-types";
import type { MessageKey } from "@/i18n/messages";

export const storyTranslate = (
  key: MessageKey,
  values?: Record<string, string | number>,
): string => {
  if (!values) {
    return key;
  }
  const template = Object.entries(values)
    .map(([name, value]) => `${name}:${value}`)
    .join(" ");
  return `${key} ${template}`;
};

export const finalGameResultFixture: GameEndedData = {
  standings: [
    {
      playerId: "p1",
      playerName: "Kai",
      finalChips: 1840,
      totalBuyIn: 1000,
      profit: 840,
      handsPlayedCount: 22,
      handsWonCount: 8,
      vpipHandsCount: 10,
    },
    {
      playerId: "p2",
      playerName: "Maya",
      finalChips: 1120,
      totalBuyIn: 1000,
      profit: 120,
      handsPlayedCount: 22,
      handsWonCount: 7,
      vpipHandsCount: 9,
    },
    {
      playerId: "p3",
      playerName: "Noah",
      finalChips: 540,
      totalBuyIn: 1000,
      profit: -460,
      handsPlayedCount: 22,
      handsWonCount: 4,
      vpipHandsCount: 8,
    },
  ],
  summary: {
    totalPlayers: 3,
    handsPlayed: 22,
    totalBuyIn: 3000,
    totalChipsInPlay: 3500,
    profitablePlayers: 2,
    averageFinalStack: 1167,
    chipLeader: {
      playerId: "p1",
      playerName: "Kai",
      amount: 1840,
    },
    biggestWinner: {
      playerId: "p1",
      playerName: "Kai",
      amount: 840,
    },
    biggestLoss: {
      playerId: "p3",
      playerName: "Noah",
      amount: 460,
    },
  },
};

export const finalSummaryCardsFixture = [
  {
    key: "hands",
    label: "Hands Played",
    value: "22",
  },
  {
    key: "players",
    label: "Total Players",
    value: "3",
  },
  {
    key: "profitable",
    label: "Profitable Players",
    value: "2 / 3",
  },
  {
    key: "avgStack",
    label: "Average Stack",
    value: "$1167",
  },
  {
    key: "totalBuyIn",
    label: "Total Buy-In",
    value: "$3000",
  },
  {
    key: "chips",
    label: "Total Chips",
    value: "$3500",
  },
];

export const finalStandingsFixture = finalGameResultFixture.standings.map((entry, index) => ({
  ...entry,
  rankOrder: index + 1,
}));

export const rankingRowsFixture = [
  {
    key: "ROYAL_FLUSH",
    order: 1,
    title: "Royal Flush",
    detail: "A, K, Q, J, 10 of the same suit.",
  },
  {
    key: "STRAIGHT_FLUSH",
    order: 2,
    title: "Straight Flush",
    detail: "Five consecutive cards of the same suit.",
  },
  {
    key: "FOUR_OF_A_KIND",
    order: 3,
    title: "Four of a Kind",
    detail: "Four cards with the same rank.",
  },
];

export const rulesCopyFixture = {
  buttonLabel: "Rules",
  modalTitle: "Texas Hold'em Rules",
  modalSubtitle: "Quick guide for your table.",
  objectiveTitle: "Objective",
  objectiveBullets: ["Make the best 5-card hand.", "Win chips from the pot."],
  flowTitle: "Hand Flow",
  flowSteps: ["Deal hole cards", "Betting rounds", "Showdown"],
  actionsTitle: "Actions",
  actionsBullets: ["Check", "Call", "Raise", "Fold", "All-in"],
  showdownTitle: "Showdown",
  showdownBullets: ["Best hand wins", "Ties split the pot"],
  tiebreakTitle: "Tie Break",
  tiebreakBullets: ["Compare kickers", "Split exact ties"],
  rankingTitle: "Hand Rankings",
  rankingHint: "Highest to lowest.",
};

export const playerRankingsFixture = [
  {
    id: "p1",
    name: "Kai",
    tableStack: 1240,
    totalBuyIn: 1000,
    net: 240,
  },
  {
    id: "p2",
    name: "Maya",
    tableStack: 980,
    totalBuyIn: 1000,
    net: -20,
  },
  {
    id: "p3",
    name: "Noah",
    tableStack: 780,
    totalBuyIn: 1000,
    net: -220,
  },
];
