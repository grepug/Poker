import { Card } from "./card.types";
import { Player, PlayerAction } from "./player.types";
import { Room, RoomConfig, SanitizedRoom } from "./room.types";
import { Hand, HandResult, BettingRound } from "./game.types";

// ============================================
// Client -> Server Events
// ============================================

export interface CreateRoomData {
  playerName: string;
  config?: Partial<RoomConfig>;
}

export interface JoinRoomData {
  roomId: string;
  playerName: string;
}

export interface ReconnectData {
  roomId: string;
  playerName: string;
}

export interface PlayerActionData {
  action: PlayerAction;
  amount?: number; // For raises
}

export interface RequestRebuyData {
  amount: number;
}

export interface ClientToServerEvents {
  CREATE_ROOM: (
    data: CreateRoomData,
    callback: (response: any) => void,
  ) => void;
  JOIN_ROOM: (data: JoinRoomData, callback: (response: any) => void) => void;
  RECONNECT: (data: ReconnectData, callback: (response: any) => void) => void;
  START_GAME: (callback: (response: any) => void) => void;
  START_NEXT_HAND: (callback: (response: any) => void) => void;
  PLAYER_ACTION: (
    data: PlayerActionData,
    callback: (response: any) => void,
  ) => void;
  REQUEST_REBUY: (
    data: RequestRebuyData,
    callback: (response: any) => void,
  ) => void;
  LEAVE_ROOM: (callback: (response: any) => void) => void;
  END_GAME: (callback: (response: any) => void) => void;
}

// ============================================
// Server -> Client Events
// ============================================

export interface RoomCreatedData {
  roomId: string;
  shareUrl: string;
  room: SanitizedRoom;
}

export interface RoomJoinedData {
  player: Player;
  room: SanitizedRoom;
}

export interface PlayerJoinedData {
  player: Omit<Player, "cards">;
}

export interface ReconnectSuccessData {
  player: Player;
  room: SanitizedRoom;
  yourCards: Card[] | null;
}

export interface ReconnectErrorData {
  reason: string;
}

export interface GameStartedData {
  hand: Omit<Hand, "activePlayers">;
  players: Array<Omit<Player, "cards"> & { hasCards: boolean }>;
}

export interface YourCardsData {
  cards: Card[];
}

export interface PlayerTurnData {
  playerId: string;
  playerName: string;
  timeLimit: number;
  currentBet: number;
  minRaise: number;
  canCheck: boolean;
}

export interface PlayerActedData {
  playerId: string;
  playerName: string;
  action: PlayerAction;
  amount?: number;
  newPot: number;
  newChips: number;
}

export interface BettingRoundCompleteData {
  nextRound: BettingRound;
}

export interface CommunityCardsDealtData {
  cards: Card[];
  round: BettingRound;
}

export interface HandCompleteData {
  result: HandResult;
}

export interface PlayerDisconnectedData {
  playerId: string;
  playerName: string;
  gracePeriod: number;
}

export interface PlayerReconnectedData {
  playerId: string;
  playerName: string;
}

export interface PlayerAutoFoldedData {
  playerId: string;
  playerName: string;
}

export interface HostChangedData {
  newHostId: string;
  newHostName: string;
}

export interface PlayerReboughtData {
  playerId: string;
  playerName: string;
  amount: number;
  newChipCount: number;
  newTotalBuyIn: number;
}

export interface PlayerLeftData {
  playerId: string;
  playerName: string;
}

export interface GameEndedData {
  standings: Array<{
    playerId: string;
    playerName: string;
    finalChips: number;
    totalBuyIn: number;
    profit: number;
  }>;
}

export interface ErrorData {
  message: string;
  code?: string;
}

export interface ServerToClientEvents {
  ROOM_CREATED: (data: RoomCreatedData) => void;
  ROOM_JOINED: (data: RoomJoinedData) => void;
  PLAYER_JOINED: (data: PlayerJoinedData) => void;
  RECONNECT_SUCCESS: (data: ReconnectSuccessData) => void;
  RECONNECT_ERROR: (data: ReconnectErrorData) => void;
  GAME_STARTED: (data: GameStartedData) => void;
  YOUR_CARDS: (data: YourCardsData) => void;
  PLAYER_TURN: (data: PlayerTurnData) => void;
  PLAYER_ACTED: (data: PlayerActedData) => void;
  BETTING_ROUND_COMPLETE: (data: BettingRoundCompleteData) => void;
  COMMUNITY_CARDS_DEALT: (data: CommunityCardsDealtData) => void;
  HAND_COMPLETE: (data: HandCompleteData) => void;
  NEW_HAND_STARTING: () => void;
  PLAYER_DISCONNECTED: (data: PlayerDisconnectedData) => void;
  PLAYER_RECONNECTED: (data: PlayerReconnectedData) => void;
  PLAYER_AUTO_FOLDED: (data: PlayerAutoFoldedData) => void;
  HOST_CHANGED: (data: HostChangedData) => void;
  PLAYER_REBOUGHT: (data: PlayerReboughtData) => void;
  PLAYER_LEFT: (data: PlayerLeftData) => void;
  GAME_ENDED: (data: GameEndedData) => void;
  ERROR: (data: ErrorData) => void;
}
