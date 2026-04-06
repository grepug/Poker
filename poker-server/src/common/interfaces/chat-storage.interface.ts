import { ChatMessage, ChatMessageKind, ChatSender, VoiceMessagePayload } from 'poker-types';

export interface ChatHistoryPage {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
}

export interface GetChatMessagesOptions {
  beforeSeq?: number;
  limit?: number;
}

export interface AppendChatMessageInput {
  roomId: string;
  sender: ChatSender;
  kind: ChatMessageKind;
  text?: string;
  voice?: VoiceMessagePayload;
  clientMessageId?: string;
}

export interface AppendChatMessageOptions {
  maxMessages?: number;
  dedupeWindowMs?: number;
}

export interface AppendChatMessageResult {
  message: ChatMessage;
  duplicate: boolean;
}

export interface PruneChatMessagesOptions {
  olderThanMs?: number;
  keepLatest?: number;
}

export interface PruneChatMessagesResult {
  deleted: number;
  remaining: number;
}

export interface IChatStorageService {
  /**
   * Return a bounded page from the current room chat projection.
   */
  getMessagePage(
    roomId: string,
    options?: GetChatMessagesOptions,
  ): Promise<ChatHistoryPage>;
  /**
   * Append one canonical chat record and update the current room chat projection.
   */
  appendMessage(
    input: AppendChatMessageInput,
    options?: AppendChatMessageOptions,
  ): Promise<AppendChatMessageResult>;
  /**
   * Check whether a room currently has chat data.
   */
  hasChatData(roomId: string): Promise<boolean>;
  /**
   * Reset a room's chat projection and append the canonical delete record.
   */
  deleteRoomChat(roomId: string): Promise<void>;
  /**
   * List room ids that currently have chat data in the bounded projection.
   */
  listRoomsWithChatData(): Promise<string[]>;
  /**
   * Prune room chat according to the current store policy while preserving
   * canonical chat log records.
   */
  pruneRoomMessages(
    roomId: string,
    options?: PruneChatMessagesOptions,
  ): Promise<PruneChatMessagesResult>;
}
