import type { Card, HandEvaluation } from "./card.types";
import type { BlindType, PlayerActionDisplayKind } from "./events.types";
import type {
  BettingRound,
  HandPositionLabel,
  PotPayout,
} from "./game.types";
import type { PlayerAction } from "./player.types";

export type HoleCardsVisibility = "self" | "revealed" | "hidden";

export type CompletedHandHistorySeat = {
  playerId: string;
  playerName: string;
  seatPosition: number;
  positionLabel: HandPositionLabel | null;
  startingStack: number;
  holeCards: Card[] | null;
  holeCardsVisibility: HoleCardsVisibility;
};

export type CompletedHandHistoryAction = {
  order: number;
  source: "blind" | "player" | "system";
  street: BettingRound;
  playerId: string;
  playerName: string;
  action: "post-blind" | PlayerAction | "reveal" | "muck";
  amount: number;
  totalBetTo?: number | null;
  potAfter: number;
  blindType?: BlindType | null;
  displayKind?: PlayerActionDisplayKind | null;
};

export type CompletedHandHistorySettlement = {
  isShowdown: boolean;
  revealedPlayerIds: string[];
  totalPot: number;
  payouts: PotPayout[];
  winners: Array<{
    playerId: string;
    playerName: string;
    hand: HandEvaluation | null;
    amountWon: number;
  }>;
  netByPlayerId: Record<string, number>;
};

export type CompletedHandHistoryExport = {
  version: 1;
  roomId: string;
  handNumber: number;
  requesterPlayerId: string;
  dealerPosition: number;
  smallBlindPosition: number;
  bigBlindPosition: number;
  blinds: {
    smallBlind: number;
    bigBlind: number;
  };
  communityCardsByStreet: {
    preFlop: Card[];
    flop: Card[];
    turn: Card[];
    river: Card[];
  };
  seats: CompletedHandHistorySeat[];
  actions: CompletedHandHistoryAction[];
  settlement: CompletedHandHistorySettlement;
};

export type CompletedGameHistoryExport = {
  version: 1;
  roomId: string;
  requesterPlayerId: string;
  handCount: number;
  hands: CompletedHandHistoryExport[];
};
