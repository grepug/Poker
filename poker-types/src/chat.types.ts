export type ChatMessageKind = 'TEXT' | 'VOICE';

export interface ChatSender {
  playerId: string;
  playerName: string;
  playerEmoji?: string;
}

export interface VoiceMessagePayload {
  audioUrl: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
}

export interface ChatMessageBase {
  id: string;
  roomId: string;
  seq: number;
  kind: ChatMessageKind;
  sender: ChatSender;
  clientMessageId?: string;
  createdAt: number;
}

export interface TextChatMessage extends ChatMessageBase {
  kind: 'TEXT';
  text: string;
}

export interface VoiceChatMessage extends ChatMessageBase {
  kind: 'VOICE';
  voice: VoiceMessagePayload;
}

export type ChatMessage = TextChatMessage | VoiceChatMessage;

export interface SendChatMessageData {
  clientMessageId: string;
  kind: ChatMessageKind;
  text?: string;
  voice?: VoiceMessagePayload;
}

export interface SendChatMessageAck {
  success: boolean;
  duplicate?: boolean;
  message?: ChatMessage;
  error?: string;
}

export interface GetChatHistoryData {
  beforeSeq?: number;
  limit?: number;
}

export interface ChatHistorySyncData {
  messages: ChatMessage[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
}

