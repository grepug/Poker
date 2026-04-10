import { Card, HandEvaluation } from "./card.types";
import { PlayerAction } from "./player.types";

// Betting round phases
export type BettingRound = "PRE_FLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";
export type RunCount = 1 | 2;

// Game state
export type GameStateType = "WAITING" | "IN_PROGRESS" | "ENDED";

type EarlyPositionOffsetLabel =
  | "UTG+1"
  | "UTG+2"
  | "UTG+3"
  | "UTG+4"
  | "UTG+5"
  | "UTG+6"
  | "UTG+7";

export type HandPositionLabel =
  | "BTN"
  | "BTN/SB"
  | "BTN/BB"
  | "SB"
  | "BB"
  | "UTG"
  | EarlyPositionOffsetLabel
  | "MP"
  | "LJ"
  | "HJ"
  | "CO";

// Side pot for all-in scenarios
export interface SidePot {
  amount: number;
  eligiblePlayers: string[]; // Player IDs who can win this pot
}

export interface RunCountDecisionState {
  eligiblePlayerIds: string[];
  twiceAgreedPlayerIds: string[];
  expiresAt: number;
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
  positionLabelsByPlayerId?: Record<string, HandPositionLabel>; // Runtime-only: current-hand position badges for dealt-in seats
  vpipPlayerIds?: string[]; // Runtime-only: players who voluntarily entered the pot pre-flop
  lastResult?: HandResult | null; // Runtime-only: final hand result for paused hand state
  revealedPlayerIds?: string[]; // Runtime-only: players who revealed their hand to the table
  pendingStreetRevealRound?: BettingRound | null; // Runtime-only: next round waiting for player confirmation
  nextStreetReadyPlayerIds?: string[]; // Runtime-only: players who have confirmed revealing next street
  nextStreetRequiredPlayerIds?: string[]; // Runtime-only: players required to confirm revealing next street
  showdownDecisionOrder?: string[]; // Runtime-only: showdown decision order by player id
  showdownDecisionIndex?: number; // Runtime-only: index of current showdown decision player
  showdownDecisionPlayerId?: string | null; // Runtime-only: current showdown decision player id
  showdownForcedRevealPlayerIds?: string[]; // Runtime-only: players forced to reveal (e.g. all-in)
  showdownLastAggressorPlayerId?: string | null; // Runtime-only: last aggressor during river action
  dealtPlayerIds?: string[]; // Runtime-only: players who were dealt into this hand
  settledPlayerCardsByPlayerId?: Record<string, Card[]>; // Runtime-only: server-only cards retained for post-hand reveal actions
  runCountDecision?: RunCountDecisionState | null; // Runtime-only: pending run-once/run-twice decision state
  runCount?: RunCount; // Runtime-only: resolved run count for this hand
  runoutBoards?: Card[][]; // Runtime-only: full board per run when the hand is run multiple times
  startedAt: number;
  minRaise?: number; // Runtime-only: computed for turn snapshots / PLAYER_TURN, not persisted
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
  runCount?: RunCount;
  runouts?: Array<{
    runIndex: number;
    board: Card[];
    winners: Array<{
      playerId: string;
      playerName: string;
      hand: HandEvaluation | null;
      amountWon: number;
    }>;
    payouts: PotPayout[];
  }>;
  winners: Array<{
    playerId: string;
    playerName: string;
    hand: HandEvaluation | null;
    amountWon: number;
  }>;
  playerHands: Array<{
    playerId: string;
    playerName: string;
    cards: Card[];
    hand: HandEvaluation | null;
    resultStatus:
      | "shown"
      | "folded_pre_showdown"
      | "folded_at_showdown"
      | "hidden_contender";
    cardsVisibility: "shown" | "hidden";
    seatPosition: number;
    runHands?: Array<{
      runIndex: number;
      hand: HandEvaluation | null;
    }>;
  }>;
  totalPot: number;
  payouts: PotPayout[];
  netByPlayerId: Record<string, number>; // Net chip change per player for this hand
}
