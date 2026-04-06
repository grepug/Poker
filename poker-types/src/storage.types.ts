import { BettingRound, HandResult } from "./game.types";
import { Card } from "./card.types";
import { ChatMessage } from "./chat.types";

export type PersistedActor = {
  playerId?: string;
  playerName?: string;
  userId?: string;
  source:
    | "SYSTEM"
    | "PLAYER"
    | "AUTH"
    | "MIGRATION"
    | "ROOM_SERVICE"
    | "HAND_SERVICE"
    | "BETTING_SERVICE"
    | "EVENTS_GATEWAY";
};

export type PersistedRoomEventType =
  | "ROOM_CREATED"
  | "ROOM_STATE_UPDATED"
  | "PLAYER_JOINED"
  | "PLAYER_REJOINED"
  | "PLAYER_PROFILE_SYNCED"
  | "PLAYER_LEFT"
  | "PLAYER_DISCONNECTED"
  | "PLAYER_RECONNECTED"
  | "PLAYER_REBOUGHT"
  | "HOST_CHANGED"
  | "ROOM_CONFIG_UPDATED"
  | "READY_STATE_UPDATED"
  | "HAND_STARTED"
  | "PLAYER_ACTION"
  | "BETTING_ROUND_ADVANCED"
  | "STREET_REVEAL_UPDATED"
  | "SHOWDOWN_DECISION_UPDATED"
  | "HAND_SETTLED"
  | "ROOM_MIGRATED";

export type PersistedRoomEventRecord = {
  recordId: string;
  seq: number;
  roomId: string;
  handNumber?: number | null;
  street?: BettingRound | null;
  timestamp: number;
  type: PersistedRoomEventType;
  actor?: PersistedActor;
  payload: Record<string, unknown>;
};

export type RoomPersistedWrite = {
  events: Omit<PersistedRoomEventRecord, "recordId" | "seq" | "timestamp">[];
};

export type PersistedRoomSnapshot = {
  lastRoomEventSeq: number;
  updatedAt: number;
};

export type PersistedChatLogRecord =
  | {
      recordId: string;
      seq: number;
      roomId: string;
      timestamp: number;
      type: "MESSAGE_APPENDED";
      message: ChatMessage;
    }
  | {
      recordId: string;
      seq: number;
      roomId: string;
      timestamp: number;
      type: "MESSAGES_PRUNED";
      deleted: number;
      remaining: number;
      olderThanMs?: number | null;
      keepLatest?: number | null;
    }
  | {
      recordId: string;
      seq: number;
      roomId: string;
      timestamp: number;
      type: "ROOM_CHAT_DELETED";
    }
  | {
      recordId: string;
      seq: number;
      roomId: string;
      timestamp: number;
      type: "CHAT_MIGRATED";
      messageCount: number;
    };

export type PersistedChatIndex = {
  roomId: string;
  createdAt: number;
  updatedAt: number;
  nextSeq: number;
  logSeq: number;
  latestMessages: ChatMessage[];
};

export type PersistedAuthLogRecord =
  | {
      recordId: string;
      seq: number;
      timestamp: number;
      type: "USER_UPSERTED";
      user: PersistedAuthUserState;
    }
  | {
      recordId: string;
      seq: number;
      timestamp: number;
      type: "USER_REMOVED";
      userId: string;
    }
  | {
      recordId: string;
      seq: number;
      timestamp: number;
      type: "SESSION_UPSERTED";
      session: PersistedAuthSessionState;
    }
  | {
      recordId: string;
      seq: number;
      timestamp: number;
      type: "SESSION_REMOVED";
      tokenHash: string;
    }
  | {
      recordId: string;
      seq: number;
      timestamp: number;
      type: "AUTH_MIGRATED";
      userCount: number;
      sessionCount: number;
    };

export type PersistedAuthUserState = {
  id: string;
  accountId: string;
  displayName: string;
  avatarEmoji: string;
  createdAt: number;
  updatedAt: number;
  passwordHash?: string;
  passkeys: PersistedAuthPasskeyCredential[];
};

export type PersistedAuthState = {
  lastLogSeq: number;
  updatedAt: number;
  users: PersistedAuthUserState[];
  sessions: PersistedAuthSessionState[];
};

export type PersistedHandStartPlayer = {
  playerId: string;
  playerName: string;
  position: number;
  chips: number;
  cards: Card[];
};

export type PersistedHandSettlement = {
  handNumber: number;
  isShowdown: boolean;
  result: HandResult;
  revealedPlayerIds: string[];
};
export type PersistedAuthPasskeyCredential = {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  createdAt: number;
  updatedAt: number;
};

export type PersistedAuthSessionState = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  lastUsedAt: number;
  createdAt: number;
};
