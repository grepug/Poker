import { Card, HandEvaluation } from "./card.types";
import { PlayerAction } from "./player.types";

// Betting round phases
export type BettingRound = "PRE_FLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";

// Game state
export type GameStateType = "WAITING" | "IN_PROGRESS" | "ENDED";

// Side pot for all-in scenarios
export interface SidePot {
  amount: number;
  eligiblePlayers: string[]; // Player IDs who can win this pot
}

// Single poker hand
export interface Hand {
  handNumber: number;
  dealerPosition: number;
  smallBlindPosition: number;
  bigBlindPosition: number;
  currentPlayerTurn: string | null; // player ID or null if hand over
  pot: number;
  communityCards: Card[];
  bettingRound: BettingRound;
  currentBet: number;
  lastRaiseSize: number; // Size of the most recent raise for min-raise calculation
  activePlayers: string[]; // Player IDs still in the hand
  roundActions: Record<string, boolean>; // Track if player acted this round
  sidePots: SidePot[];
  potContributions: Record<string, number>; // Total chips each player put into the pot this hand
  lastResult?: HandResult | null; // Runtime-only: final hand result for paused hand state
  revealedPlayerIds?: string[]; // Runtime-only: players who revealed their hand to the table
  pendingStreetRevealRound?: BettingRound | null; // Runtime-only: next round waiting for player confirmation
  nextStreetReadyPlayerIds?: string[]; // Runtime-only: players who have confirmed revealing next street
  nextStreetRequiredPlayerIds?: string[]; // Runtime-only: players required to confirm revealing next street
  startedAt: number;
  minRaise?: number; // Runtime-only: sent via PLAYER_TURN event, not persisted
}

export interface PotPayout {
  segmentIndex: number; // 0 = main pot, 1+ = side pots
  potType: "MAIN" | "SIDE";
  amount: number;
  eligiblePlayerIds: string[];
  winnerShares: Array<{
    playerId: string;
    amountWon: number;
  }>;
  uncontested: boolean;
}

// Result of a completed hand
export interface HandResult {
  winners: Array<{
    playerId: string;
    playerName: string;
    hand: HandEvaluation;
    amountWon: number;
  }>;
  playerHands: Array<{
    playerId: string;
    playerName: string;
    cards: Card[];
    hand: HandEvaluation;
  }>;
  totalPot: number;
  payouts: PotPayout[];
}
