import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppendChatMessageInput,
  AppendChatMessageOptions,
  AppendChatMessageResult,
  ChatHistoryPage,
  GetChatMessagesOptions,
  IChatStorageService,
  PruneChatMessagesOptions,
  PruneChatMessagesResult,
} from '../common/interfaces/chat-storage.interface';
import { ChatMessage } from 'poker-types';
import * as fs from 'fs/promises';
import * as path from 'path';

type PersistedChatRoomData = {
  roomId: string;
  createdAt: number;
  updatedAt: number;
  nextSeq: number;
  messages: ChatMessage[];
};

@Injectable()
export class JsonChatStorageService implements IChatStorageService {
  private readonly logger = new Logger(JsonChatStorageService.name);
  private readonly dataDir: string;
  private readonly chatDir: string;
  private readonly roomWriteQueues: Map<string, Promise<void>> = new Map();
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;
  private readonly defaultDedupeWindowMs: number;

  constructor(private readonly configService: ConfigService) {
    this.dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.chatDir = path.join(this.dataDir, 'chat');
    this.defaultPageSize = Number(
      this.configService.get<string>('CHAT_PAGE_SIZE') || '50',
    );
    this.maxPageSize = Number(
      this.configService.get<string>('CHAT_PAGE_MAX_SIZE') || '200',
    );
    this.defaultDedupeWindowMs = Number(
      this.configService.get<string>('CHAT_DEDUPE_WINDOW_MS') ||
        `${10 * 60 * 1000}`,
    );

    this.ensureDirectories().catch((error) =>
      this.logger.error(
        `Failed to initialize chat directory: ${error.message}`,
      ),
    );
  }

  async getMessagePage(
    roomId: string,
    options?: GetChatMessagesOptions,
  ): Promise<ChatHistoryPage> {
    const persisted = await this.readRoomData(roomId);
    if (!persisted || persisted.messages.length === 0) {
      return {
        messages: [],
        hasMore: false,
        nextBeforeSeq: null,
      };
    }

    const safeLimit = this.normalizeLimit(options?.limit);
    const beforeSeq =
      options?.beforeSeq !== undefined && Number.isFinite(options.beforeSeq)
        ? Math.max(1, Math.floor(options.beforeSeq))
        : Number.POSITIVE_INFINITY;

    const eligibleMessages = persisted.messages.filter((message) => {
      if (!Number.isFinite(beforeSeq)) {
        return true;
      }
      return message.seq < beforeSeq;
    });

    if (eligibleMessages.length === 0) {
      return {
        messages: [],
        hasMore: false,
        nextBeforeSeq: null,
      };
    }

    const startIndex = Math.max(0, eligibleMessages.length - safeLimit);
    const pageMessages = eligibleMessages.slice(startIndex);

    return {
      messages: pageMessages,
      hasMore: startIndex > 0,
      nextBeforeSeq:
        startIndex > 0 && pageMessages.length > 0
          ? pageMessages[0].seq
          : null,
    };
  }

  async appendMessage(
    input: AppendChatMessageInput,
    options?: AppendChatMessageOptions,
  ): Promise<AppendChatMessageResult> {
    return this.runRoomWriteSequentially(input.roomId, async () => {
      const now = Date.now();
      const persisted =
        (await this.readRoomData(input.roomId)) ||
        this.createInitialRoomData(input.roomId, now);
      const dedupeWindowMs =
        options?.dedupeWindowMs ?? this.defaultDedupeWindowMs;

      if (input.clientMessageId) {
        const duplicated = this.findDuplicateMessage(
          persisted.messages,
          input.clientMessageId,
          input.sender.playerId,
          now,
          dedupeWindowMs,
        );
        if (duplicated) {
          return {
            message: duplicated,
            duplicate: true,
          };
        }
      }

      const seq = Math.max(1, Math.floor(persisted.nextSeq));
      const messageBase = {
        id: crypto.randomUUID(),
        roomId: input.roomId,
        seq,
        sender: input.sender,
        clientMessageId: input.clientMessageId,
        createdAt: now,
      };

      const message: ChatMessage =
        input.kind === 'VOICE'
          ? {
              ...messageBase,
              kind: 'VOICE',
              voice: input.voice!,
            }
          : {
              ...messageBase,
              kind: 'TEXT',
              text: input.text!,
            };

      persisted.messages.push(message);
      persisted.nextSeq = seq + 1;
      persisted.updatedAt = now;

      const maxMessages = options?.maxMessages;
      if (
        maxMessages !== undefined &&
        Number.isFinite(maxMessages) &&
        maxMessages > 0 &&
        persisted.messages.length > maxMessages
      ) {
        persisted.messages = persisted.messages.slice(-Math.floor(maxMessages));
      }

      await this.writeRoomData(input.roomId, persisted);

      return {
        message,
        duplicate: false,
      };
    });
  }

  async hasChatData(roomId: string): Promise<boolean> {
    const persisted = await this.readRoomData(roomId);
    return Boolean(persisted && persisted.messages.length > 0);
  }

  async deleteRoomChat(roomId: string): Promise<void> {
    await this.runRoomWriteSequentially(roomId, async () => {
      await this.unlinkRoomFile(roomId);
    });
  }

  async listRoomsWithChatData(): Promise<string[]> {
    await this.ensureDirectories();
    const files = await fs.readdir(this.chatDir);
    const roomIds: string[] = [];

    for (const fileName of files) {
      if (!fileName.endsWith('.json')) {
        continue;
      }

      const roomId = fileName.replace(/\.json$/, '');
      try {
        const hasData = await this.hasChatData(roomId);
        if (hasData) {
          roomIds.push(roomId);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping chat file ${fileName} due to parse/read error: ${(error as Error).message}`,
        );
      }
    }

    return roomIds;
  }

  async pruneRoomMessages(
    roomId: string,
    options?: PruneChatMessagesOptions,
  ): Promise<PruneChatMessagesResult> {
    return this.runRoomWriteSequentially(roomId, async () => {
      const persisted = await this.readRoomData(roomId);
      if (!persisted || persisted.messages.length === 0) {
        return {
          deleted: 0,
          remaining: 0,
        };
      }

      const originalMessages = persisted.messages;
      let nextMessages = [...originalMessages];

      if (
        options?.olderThanMs !== undefined &&
        Number.isFinite(options.olderThanMs)
      ) {
        nextMessages = nextMessages.filter(
          (message) => message.createdAt >= Number(options.olderThanMs),
        );
      }

      if (options?.keepLatest !== undefined && Number.isFinite(options.keepLatest)) {
        const safeKeepLatest = Math.max(0, Math.floor(options.keepLatest));
        if (safeKeepLatest === 0) {
          nextMessages = [];
        } else if (nextMessages.length > safeKeepLatest) {
          nextMessages = nextMessages.slice(-safeKeepLatest);
        }
      }

      const deleted = originalMessages.length - nextMessages.length;
      if (deleted <= 0) {
        return {
          deleted: 0,
          remaining: originalMessages.length,
        };
      }

      if (nextMessages.length === 0) {
        await this.unlinkRoomFile(roomId);
        return {
          deleted,
          remaining: 0,
        };
      }

      persisted.messages = nextMessages;
      persisted.nextSeq = Math.max(
        persisted.nextSeq,
        nextMessages[nextMessages.length - 1].seq + 1,
      );
      persisted.updatedAt = Date.now();

      await this.writeRoomData(roomId, persisted);

      return {
        deleted,
        remaining: nextMessages.length,
      };
    });
  }

  private async runRoomWriteSequentially<T>(
    roomId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousQueue = this.roomWriteQueues.get(roomId) || Promise.resolve();
    let releaseCurrent: () => void = () => {};

    const gate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const nextQueue = previousQueue.finally(() => gate);
    this.roomWriteQueues.set(roomId, nextQueue);

    await previousQueue.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.roomWriteQueues.get(roomId) === nextQueue) {
        this.roomWriteQueues.delete(roomId);
      }
    }
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) {
      return Math.min(this.defaultPageSize, this.maxPageSize);
    }

    return Math.min(
      this.maxPageSize,
      Math.max(1, Math.floor(limit)),
    );
  }

  private getRoomFilePath(roomId: string): string {
    return path.join(this.chatDir, `${roomId}.json`);
  }

  private async unlinkRoomFile(roomId: string): Promise<void> {
    const filePath = this.getRoomFilePath(roomId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.chatDir, { recursive: true });
  }

  private createInitialRoomData(
    roomId: string,
    createdAt: number,
  ): PersistedChatRoomData {
    return {
      roomId,
      createdAt,
      updatedAt: createdAt,
      nextSeq: 1,
      messages: [],
    };
  }

  private findDuplicateMessage(
    messages: ChatMessage[],
    clientMessageId: string,
    playerId: string,
    now: number,
    dedupeWindowMs: number,
  ): ChatMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (now - message.createdAt > dedupeWindowMs) {
        break;
      }

      if (
        message.clientMessageId === clientMessageId &&
        message.sender.playerId === playerId
      ) {
        return message;
      }
    }

    return null;
  }

  private async readRoomData(
    roomId: string,
  ): Promise<PersistedChatRoomData | null> {
    try {
      const filePath = this.getRoomFilePath(roomId);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedChatRoomData>;

      const messages = Array.isArray(parsed.messages)
        ? [...parsed.messages].sort((left, right) => left.seq - right.seq)
        : [];
      const highestSeq =
        messages.length === 0 ? 0 : messages[messages.length - 1].seq;
      const nextSeq =
        typeof parsed.nextSeq === 'number' && parsed.nextSeq > 0
          ? Math.max(Math.floor(parsed.nextSeq), highestSeq + 1)
          : highestSeq + 1;
      const now = Date.now();

      return {
        roomId,
        createdAt:
          typeof parsed.createdAt === 'number' ? parsed.createdAt : now,
        updatedAt:
          typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
        nextSeq,
        messages,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      this.logger.error(
        `Failed to read chat data for room ${roomId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private async writeRoomData(
    roomId: string,
    data: PersistedChatRoomData,
  ): Promise<void> {
    await this.ensureDirectories();

    const filePath = this.getRoomFilePath(roomId);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(data, null, 2);

    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(tempPath, 'w');
      await handle.writeFile(payload, 'utf-8');
      await handle.sync();
    } finally {
      if (handle) {
        await handle.close();
      }
    }

    await fs.rename(tempPath, filePath);
  }
}
