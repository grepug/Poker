import { Player } from "./player.types";
import { Hand, GameStateType } from "./game.types";

// Room configuration
export interface RoomConfig {
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number; // 2-10
  reconnectGracePeriod: number; // milliseconds (default 120000)
  allowPlayerStreetReveal: boolean; // require each player to confirm before revealing the next street
}

// Complete room state
export interface Room {
  id: string;
  hostId: string;
  config: RoomConfig;
  players: Player[];
  gameState: GameStateType;
  currentHand: Hand | null;
  createdAt: number;
  lastActivityAt: number;
}

// Sanitized room data for client (hides private card info)
export interface SanitizedRoom {
  id: string;
  hostId: string;
  config: RoomConfig;
  players: Array<Omit<Player, "cards"> & { hasCards: boolean }>;
  gameState: GameStateType;
  currentHand: Omit<Hand, "activePlayers"> | null;
  createdAt: number;
}
