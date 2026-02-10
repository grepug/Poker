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
  getMessagePage(
    roomId: string,
    options?: GetChatMessagesOptions,
  ): Promise<ChatHistoryPage>;
  appendMessage(
    input: AppendChatMessageInput,
    options?: AppendChatMessageOptions,
  ): Promise<AppendChatMessageResult>;
  hasChatData(roomId: string): Promise<boolean>;
  deleteRoomChat(roomId: string): Promise<void>;
  listRoomsWithChatData(): Promise<string[]>;
  pruneRoomMessages(
    roomId: string,
    options?: PruneChatMessagesOptions,
  ): Promise<PruneChatMessagesResult>;
}
