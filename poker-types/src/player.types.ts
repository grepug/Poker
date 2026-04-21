import { Card } from "./card.types";

// Player status
export type PlayerStatus =
  | "waiting" // In room, waiting for game to start
  | "connected" // Gameplay state for an active in-hand player; use connectionStatus for transport connectivity
  | "disconnected" // Legacy/back-compat gameplay value; prefer connectionStatus for disconnect handling
  | "folded" // Folded current hand
  | "all-in" // All chips in pot
  | "left"; // Permanently left room

export type PlayerConnectionStatus = "connected" | "disconnected";

export const ROBOT_PERSONALITIES = [
  "tight",
  "balanced",
  "bully",
  "chaotic",
] as const;

export type RobotPersonality = (typeof ROBOT_PERSONALITIES)[number];

// Player actions during betting
export type PlayerAction = "fold" | "check" | "call" | "raise" | "all-in";

export interface Player {
  id: string;
  socketId: string;
  name: string;
  isRobot?: boolean;
  robotPersonality?: RobotPersonality;
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
