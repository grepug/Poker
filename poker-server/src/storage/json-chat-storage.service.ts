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
import {
  ChatMessage,
  PersistedChatIndex,
  PersistedChatLogRecord,
} from 'poker-types';
import { randomUUID } from 'crypto';
import {
  appendJsonlRecords,
  ensureDir,
  pathExists,
  readJsonFile,
  readJsonlRecords,
  writeJsonFileAtomic,
} from './jsonl-store.util';
import * as fs from 'fs/promises';
import * as path from 'path';

type LegacyChatRoomData = {
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
    await this.ensureDirectories();
    await this.migrateLegacyChatIfNeeded(roomId);

    const index = await this.readChatIndex(roomId);
    if (!index || index.latestMessages.length === 0) {
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

    const eligibleMessages = index.latestMessages.filter((message) => {
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
      await this.ensureDirectories();
      await this.migrateLegacyChatIfNeeded(input.roomId);

      const now = Date.now();
      const index =
        (await this.readChatIndex(input.roomId)) ??
        this.createEmptyIndex(input.roomId, now);
      const dedupeWindowMs =
        options?.dedupeWindowMs ?? this.defaultDedupeWindowMs;

      if (input.clientMessageId) {
        const duplicated = this.findDuplicateMessage(
          index.latestMessages,
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

      const seq = Math.max(1, Math.floor(index.nextSeq));
      const messageBase = {
        id: randomUUID(),
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

      const nextMessages = [...index.latestMessages, message];
      const maxMessages = options?.maxMessages;
      const boundedMessages =
        maxMessages !== undefined &&
        Number.isFinite(maxMessages) &&
        maxMessages > 0 &&
        nextMessages.length > maxMessages
          ? nextMessages.slice(-Math.floor(maxMessages))
          : nextMessages;

      let nextLogSeq = index.logSeq;
      const logRecords: PersistedChatLogRecord[] = [];

      logRecords.push({
        recordId: randomUUID(),
        seq: ++nextLogSeq,
        roomId: input.roomId,
        timestamp: now,
        type: 'MESSAGE_APPENDED',
        message,
      });

      if (boundedMessages.length < nextMessages.length) {
        logRecords.push({
          recordId: randomUUID(),
          seq: ++nextLogSeq,
          roomId: input.roomId,
          timestamp: now,
          type: 'MESSAGES_PRUNED',
          deleted: nextMessages.length - boundedMessages.length,
          remaining: boundedMessages.length,
          olderThanMs: null,
          keepLatest: maxMessages ?? null,
        });
      }

      await appendJsonlRecords(this.getChatLogPath(input.roomId), logRecords);
      await this.writeChatIndex(input.roomId, {
        roomId: input.roomId,
        createdAt: index.createdAt,
        updatedAt: now,
        nextSeq: seq + 1,
        logSeq: nextLogSeq,
        latestMessages: boundedMessages,
      });

      return {
        message,
        duplicate: false,
      };
    });
  }

  async hasChatData(roomId: string): Promise<boolean> {
    await this.ensureDirectories();
    await this.migrateLegacyChatIfNeeded(roomId);
    const index = await this.readChatIndex(roomId);
    return Boolean(index && index.latestMessages.length > 0);
  }

  async deleteRoomChat(roomId: string): Promise<void> {
    await this.runRoomWriteSequentially(roomId, async () => {
      await this.ensureDirectories();
      await this.migrateLegacyChatIfNeeded(roomId);

      const index =
        (await this.readChatIndex(roomId)) ?? this.createEmptyIndex(roomId, Date.now());
      const now = Date.now();
      const logRecord: PersistedChatLogRecord = {
        recordId: randomUUID(),
        seq: index.logSeq + 1,
        roomId,
        timestamp: now,
        type: 'ROOM_CHAT_DELETED',
      };

      await appendJsonlRecords(this.getChatLogPath(roomId), [logRecord]);
      await this.writeChatIndex(roomId, {
        roomId,
        createdAt: now,
        updatedAt: now,
        nextSeq: 1,
        logSeq: logRecord.seq,
        latestMessages: [],
      });
    });
  }

  async listRoomsWithChatData(): Promise<string[]> {
    await this.ensureDirectories();
    await this.migrateLegacyChatsInDirectory();

    const entries = await fs.readdir(this.chatDir, { withFileTypes: true });
    const roomIds: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const index = await this.readChatIndex(entry.name);
        if (index && index.latestMessages.length > 0) {
          roomIds.push(entry.name);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping chat room ${entry.name} due to read error: ${(error as Error).message}`,
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
      await this.ensureDirectories();
      await this.migrateLegacyChatIfNeeded(roomId);

      const index = await this.readChatIndex(roomId);
      if (!index || index.latestMessages.length === 0) {
        return {
          deleted: 0,
          remaining: 0,
        };
      }

      let nextMessages = [...index.latestMessages];
      if (
        options?.olderThanMs !== undefined &&
        Number.isFinite(options.olderThanMs)
      ) {
        nextMessages = nextMessages.filter(
          (message) => message.createdAt >= Number(options.olderThanMs),
        );
      }

      if (
        options?.keepLatest !== undefined &&
        Number.isFinite(options.keepLatest)
      ) {
        const safeKeepLatest = Math.max(0, Math.floor(options.keepLatest));
        if (safeKeepLatest === 0) {
          nextMessages = [];
        } else if (nextMessages.length > safeKeepLatest) {
          nextMessages = nextMessages.slice(-safeKeepLatest);
        }
      }

      const deleted = index.latestMessages.length - nextMessages.length;
      if (deleted <= 0) {
        return {
          deleted: 0,
          remaining: index.latestMessages.length,
        };
      }

      const now = Date.now();
      const logRecord: PersistedChatLogRecord = {
        recordId: randomUUID(),
        seq: index.logSeq + 1,
        roomId,
        timestamp: now,
        type: 'MESSAGES_PRUNED',
        deleted,
        remaining: nextMessages.length,
        olderThanMs: options?.olderThanMs ?? null,
        keepLatest: options?.keepLatest ?? null,
      };

      await appendJsonlRecords(this.getChatLogPath(roomId), [logRecord]);
      await this.writeChatIndex(roomId, {
        roomId,
        createdAt: index.createdAt,
        updatedAt: now,
        nextSeq:
          nextMessages.length === 0
            ? 1
            : Math.max(
                index.nextSeq,
                nextMessages[nextMessages.length - 1].seq + 1,
              ),
        logSeq: logRecord.seq,
        latestMessages: nextMessages,
      });

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

    return Math.min(this.maxPageSize, Math.max(1, Math.floor(limit)));
  }

  private async ensureDirectories(): Promise<void> {
    await ensureDir(this.chatDir);
  }

  private getLegacyChatPath(roomId: string): string {
    return path.join(this.chatDir, `${roomId}.json`);
  }

  private getRoomDir(roomId: string): string {
    return path.join(this.chatDir, roomId);
  }

  private getChatLogPath(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'messages.jsonl');
  }

  private getChatIndexPath(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'chat.index.json');
  }

  private createEmptyIndex(roomId: string, now: number): PersistedChatIndex {
    return {
      roomId,
      createdAt: now,
      updatedAt: now,
      nextSeq: 1,
      logSeq: 0,
      latestMessages: [],
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

  private async readChatIndex(roomId: string): Promise<PersistedChatIndex | null> {
    const index = await readJsonFile<PersistedChatIndex>(this.getChatIndexPath(roomId));
    if (index) {
      return index;
    }

    return await this.rebuildChatIndexFromLog(roomId);
  }

  private async writeChatIndex(
    roomId: string,
    index: PersistedChatIndex,
  ): Promise<void> {
    await writeJsonFileAtomic(this.getChatIndexPath(roomId), index);
  }

  private async rebuildChatIndexFromLog(
    roomId: string,
  ): Promise<PersistedChatIndex | null> {
    const records = await readJsonlRecords<PersistedChatLogRecord>(
      this.getChatLogPath(roomId),
    );
    if (records.length === 0) {
      return null;
    }

    const index = this.createEmptyIndex(roomId, records[0].timestamp);
    for (const record of records) {
      index.logSeq = record.seq;
      index.updatedAt = record.timestamp;

      if (record.type === 'MESSAGE_APPENDED') {
        index.latestMessages.push(record.message);
        index.nextSeq = Math.max(index.nextSeq, record.message.seq + 1);
        continue;
      }

      if (record.type === 'MESSAGES_PRUNED') {
        let nextMessages = [...index.latestMessages];
        if (
          record.olderThanMs !== undefined &&
          record.olderThanMs !== null &&
          Number.isFinite(record.olderThanMs)
        ) {
          nextMessages = nextMessages.filter(
            (message) => message.createdAt >= Number(record.olderThanMs),
          );
        }

        if (
          record.keepLatest !== undefined &&
          record.keepLatest !== null &&
          Number.isFinite(record.keepLatest)
        ) {
          const safeKeepLatest = Math.max(0, Math.floor(record.keepLatest));
          if (safeKeepLatest === 0) {
            nextMessages = [];
          } else if (nextMessages.length > safeKeepLatest) {
            nextMessages = nextMessages.slice(-safeKeepLatest);
          }
        }

        index.latestMessages = nextMessages;
        index.nextSeq =
          nextMessages.length === 0
            ? 1
            : Math.max(index.nextSeq, nextMessages[nextMessages.length - 1].seq + 1);
        continue;
      }

      if (record.type === 'ROOM_CHAT_DELETED') {
        index.createdAt = record.timestamp;
        index.updatedAt = record.timestamp;
        index.nextSeq = 1;
        index.latestMessages = [];
        continue;
      }
    }

    await this.writeChatIndex(roomId, index);
    return index;
  }

  private async migrateLegacyChatsInDirectory(): Promise<void> {
    const entries = await fs.readdir(this.chatDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      await this.migrateLegacyChatIfNeeded(entry.name.replace(/\.json$/, ''));
    }
  }

  private async migrateLegacyChatIfNeeded(roomId: string): Promise<void> {
    const legacyPath = this.getLegacyChatPath(roomId);
    const hasLegacy = await pathExists(legacyPath);
    const hasLog = await pathExists(this.getChatLogPath(roomId));
    const hasIndex = await pathExists(this.getChatIndexPath(roomId));
    if (!hasLegacy || hasLog || hasIndex) {
      return;
    }

    const legacy = await readJsonFile<LegacyChatRoomData>(legacyPath);
    if (!legacy) {
      return;
    }

    let seq = 0;
    const migratedAt = Number(legacy.updatedAt || legacy.createdAt || Date.now());
    const records: PersistedChatLogRecord[] = [
      {
        recordId: randomUUID(),
        seq: ++seq,
        roomId,
        timestamp: migratedAt,
        type: 'CHAT_MIGRATED',
        messageCount: legacy.messages.length,
      },
      ...legacy.messages.map((message) => ({
        recordId: randomUUID(),
        seq: ++seq,
        roomId,
        timestamp: message.createdAt,
        type: 'MESSAGE_APPENDED' as const,
        message,
      })),
    ];

    await appendJsonlRecords(this.getChatLogPath(roomId), records);
    await this.writeChatIndex(roomId, {
      roomId,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      nextSeq:
        typeof legacy.nextSeq === 'number' && legacy.nextSeq > 0
          ? legacy.nextSeq
          : legacy.messages.length + 1,
      logSeq: seq,
      latestMessages: legacy.messages,
    });
    await fs.rm(legacyPath, { force: true });
    this.logger.log(`Migrated legacy chat history ${roomId} to JSONL layout`);
  }
}
