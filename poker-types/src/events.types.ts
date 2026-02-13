import { Card } from "./card.types";
import { Player, PlayerAction, PlayerStatus } from "./player.types";
import { RoomConfig, ReadyPhase, SanitizedRoom } from "./room.types";
import { Hand, HandResult, BettingRound } from "./game.types";
import {
  ChatHistorySyncData,
  ChatMessage,
  GetChatHistoryData,
  SendChatMessageData,
  SendChatMessageAck,
} from "./chat.types";

// ============================================
// Client -> Server Events
// ============================================

export interface CreateRoomData {
  playerName: string;
  playerEmoji?: string;
  config?: Partial<RoomConfig>;
}

export interface JoinRoomData {
  roomId: string;
  playerName: string;
  playerEmoji?: string;
}

export interface ReconnectData {
  roomId: string;
  playerName: string;
  playerId?: string;
}

export interface PlayerActionData {
  action: PlayerAction;
  amount?: number; // For raises
  actionId?: string; // Idempotency key for deduplicating retries
}

export interface RequestRebuyData {
  amount: number;
}

export interface ShowMyHandData {}
export interface RevealNextStreetData {}

export interface UpdateRoomConfigData {
  config: Partial<Pick<RoomConfig, "allowPlayerStreetReveal">>;
}

export interface PlayerReadyData {}

export interface GetChatHistoryAck extends ChatHistorySyncData {
  success: boolean;
  error?: string;
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
  SHOW_MY_HAND: (
    data: ShowMyHandData,
    callback: (response: any) => void,
  ) => void;
  REVEAL_NEXT_STREET: (
    data: RevealNextStreetData,
    callback: (response: any) => void,
  ) => void;
  UPDATE_ROOM_CONFIG: (
    data: UpdateRoomConfigData,
    callback: (response: any) => void,
  ) => void;
  PLAYER_READY: (
    data: PlayerReadyData,
    callback: (response: any) => void,
  ) => void;
  PLAYER_ACTION: (
    data: PlayerActionData,
    callback: (response: any) => void,
  ) => void;
  REQUEST_REBUY: (
    data: RequestRebuyData,
    callback: (response: any) => void,
  ) => void;
  SEND_CHAT_MESSAGE: (
    data: SendChatMessageData,
    callback: (response: SendChatMessageAck) => void,
  ) => void;
  GET_CHAT_HISTORY: (
    data: GetChatHistoryData,
    callback: (response: GetChatHistoryAck) => void,
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
  playerStatus?: PlayerStatus;
  amount?: number;
  displayKind?: PlayerActionDisplayKind;
  totalBetAfterAction?: number;
  committedAmount?: number;
  blindType?: BlindType | null;
  newPot: number;
  newChips: number;
}

export type BlindType = "SB" | "BB";

export type PlayerActionDisplayKind =
  | "blind"
  | "bet-to"
  | "raise-to"
  | "call-to"
  | "all-in-to"
  | "check"
  | "fold";

export interface BettingRoundCompleteData {
  nextRound: BettingRound;
  awaitingPlayerStreetReveal?: boolean;
  readyPlayerIds?: string[];
  requiredPlayerIds?: string[];
}

export interface CommunityCardsDealtData {
  cards: Card[];
  round: BettingRound;
}

export interface HandCompleteData {
  result: HandResult;
  handNumber: number;
  isShowdown: boolean;
  revealedPlayerIds: string[];
}

export interface PlayerHandRevealedData {
  playerId: string;
  playerName: string;
  handNumber: number;
}

export interface NextStreetRevealStateData {
  nextRound: BettingRound;
  readyPlayerIds: string[];
  requiredPlayerIds: string[];
}

export interface PlayerDisconnectedData {
  playerId: string;
  playerName: string;
  gracePeriod: number;
}

export interface PlayerReconnectedData {
  playerId: string;
  playerName: string;
  status?: PlayerStatus;
}

export interface PlayerAutoFoldedData {
  playerId: string;
  playerName: string;
}

export interface HostChangedData {
  newHostId: string;
  newHostName: string;
}

export interface RoomConfigUpdatedData {
  config: RoomConfig;
}

export interface ReadyStateUpdatedData {
  phase: ReadyPhase | null;
  readyPlayerIds: string[];
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
    handsPlayedCount: number;
    handsWonCount: number;
    vpipHandsCount: number;
  }>;
  summary: {
    totalPlayers: number;
    handsPlayed: number;
    totalBuyIn: number;
    totalChipsInPlay: number;
    profitablePlayers: number;
    averageFinalStack: number;
    chipLeader: {
      playerId: string;
      playerName: string;
      amount: number;
    } | null;
    biggestWinner: {
      playerId: string;
      playerName: string;
      amount: number;
    } | null;
    biggestLoss: {
      playerId: string;
      playerName: string;
      amount: number;
    } | null;
  };
}

export interface ErrorData {
  message: string;
  code?: string;
}

export interface ChatMessageAddedData {
  message: ChatMessage;
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
  PLAYER_HAND_REVEALED: (data: PlayerHandRevealedData) => void;
  NEXT_STREET_REVEAL_STATE: (data: NextStreetRevealStateData) => void;
  NEW_HAND_STARTING: () => void;
  PLAYER_DISCONNECTED: (data: PlayerDisconnectedData) => void;
  PLAYER_RECONNECTED: (data: PlayerReconnectedData) => void;
  PLAYER_AUTO_FOLDED: (data: PlayerAutoFoldedData) => void;
  HOST_CHANGED: (data: HostChangedData) => void;
  ROOM_CONFIG_UPDATED: (data: RoomConfigUpdatedData) => void;
  READY_STATE_UPDATED: (data: ReadyStateUpdatedData) => void;
  PLAYER_REBOUGHT: (data: PlayerReboughtData) => void;
  PLAYER_LEFT: (data: PlayerLeftData) => void;
  GAME_ENDED: (data: GameEndedData) => void;
  CHAT_HISTORY_SYNC: (data: ChatHistorySyncData) => void;
  CHAT_MESSAGE_ADDED: (data: ChatMessageAddedData) => void;
  ERROR: (data: ErrorData) => void;
}
