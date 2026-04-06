import { Card } from "./card.types";

// Player status
export type PlayerStatus =
  | "waiting" // In room, waiting for game to start
  | "connected" // In game, connected
  | "disconnected" // In game, temporarily disconnected
  | "folded" // Folded current hand
  | "all-in" // All chips in pot
  | "left"; // Permanently left room

export type PlayerConnectionStatus = "connected" | "disconnected";

// Player actions during betting
export type PlayerAction = "fold" | "check" | "call" | "raise" | "all-in";

export interface Player {
  id: string;
  socketId: string;
  name: string;
  emoji?: string;
  chips: number;
  totalBuyIn: number;
  handsPlayedCount: number;
  handsWonCount: number;
  vpipHandsCount: number; // Voluntarily Put Money In Pot (pre-flop, excludes forced blinds)
  position: number; // Seat position 0-9
  status: PlayerStatus;
  connectionStatus?: PlayerConnectionStatus;
  cards: Card[] | null; // null if not in active hand
  currentBet: number; // Current bet in active betting round
  lastAction: PlayerAction | null;
  lastConnectedAt: number;
}

export interface ActionHistory {
  playerId: string;
  playerName: string;
  action: PlayerAction;
  amount?: number;
  timestamp: number;
}
