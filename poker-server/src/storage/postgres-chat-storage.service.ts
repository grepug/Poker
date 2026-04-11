import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type {
  AppendChatMessageInput,
  AppendChatMessageOptions,
  AppendChatMessageResult,
  ChatHistoryPage,
  GetChatMessagesOptions,
  IChatStorageService,
  PruneChatMessagesOptions,
  PruneChatMessagesResult,
} from '../common/interfaces/chat-storage.interface';
import { DRIZZLE_DB } from '../db/database.constants';
import type { PokerDb } from '../db/database.module';
import { chatEventsTable, chatIndexesTable } from '../db/schema';
import type {
  ChatMessage,
  PersistedChatIndex,
  PersistedChatLogRecord,
} from 'poker-types';

@Injectable()
export class PostgresChatStorageService implements IChatStorageService {
  private readonly logger = new Logger(PostgresChatStorageService.name);
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;
  private readonly defaultMaxMessages: number;
  private readonly defaultDedupeWindowMs: number;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: PokerDb,
    private readonly configService: ConfigService,
  ) {
    this.defaultPageSize = Number(
      this.configService.get<string>('CHAT_PAGE_SIZE') || '50',
    );
    this.maxPageSize = Number(
      this.configService.get<string>('CHAT_PAGE_MAX_SIZE') || '200',
    );
    this.defaultMaxMessages = Number(
      this.configService.get<string>('CHAT_MAX_MESSAGES') ||
        this.configService.get<string>('CHAT_PAGE_MAX_SIZE') ||
        '200',
    );
    this.defaultDedupeWindowMs = Number(
      this.configService.get<string>('CHAT_DEDUPE_WINDOW_MS') ||
        `${10 * 60 * 1000}`,
    );
  }

  async getMessagePage(
    roomId: string,
    options?: GetChatMessagesOptions,
  ): Promise<ChatHistoryPage> {
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
    return await this.db.transaction(async (tx) => {
      await this.lockRoom(tx, input.roomId);

      const now = Date.now();
      const index =
        (await this.readChatIndex(input.roomId, tx)) ??
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
      const maxMessages = this.resolveMaxMessages(options?.maxMessages);
      const boundedMessages = this.boundMessages(nextMessages, maxMessages);

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
          keepLatest: maxMessages,
        });
      }

      await tx.insert(chatEventsTable).values(
        logRecords.map((record) => ({
          roomId: record.roomId,
          seq: record.seq,
          recordId: record.recordId,
          timestamp: record.timestamp,
          type: record.type,
          messageSeq: record.type === 'MESSAGE_APPENDED' ? record.message.seq : null,
          record,
        })),
      );

      await this.writeChatIndex(
        input.roomId,
        {
          roomId: input.roomId,
          createdAt: index.createdAt,
          updatedAt: now,
          nextSeq: seq + 1,
          logSeq: nextLogSeq,
          latestMessages: boundedMessages,
        },
        tx,
      );

      return {
        message,
        duplicate: false,
      };
    });
  }

  async hasChatData(roomId: string): Promise<boolean> {
    const index = await this.readChatIndex(roomId);
    return Boolean(index && index.latestMessages.length > 0);
  }

  async deleteRoomChat(roomId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRoom(tx, roomId);

      const index =
        (await this.readChatIndex(roomId, tx)) ??
        this.createEmptyIndex(roomId, Date.now());
      const now = Date.now();
      const logRecord: PersistedChatLogRecord = {
        recordId: randomUUID(),
        seq: index.logSeq + 1,
        roomId,
        timestamp: now,
        type: 'ROOM_CHAT_DELETED',
      };

      await tx.insert(chatEventsTable).values({
        roomId,
        seq: logRecord.seq,
        recordId: logRecord.recordId,
        timestamp: now,
        type: logRecord.type,
        messageSeq: null,
        record: logRecord,
      });

      await this.writeChatIndex(
        roomId,
        {
          roomId,
          createdAt: now,
          updatedAt: now,
          nextSeq: 1,
          logSeq: logRecord.seq,
          latestMessages: [],
        },
        tx,
      );
    });
  }

  async listRoomsWithChatData(): Promise<string[]> {
    const rows = await this.db.select().from(chatIndexesTable);
    return rows
      .filter((row) => row.latestMessages.length > 0)
      .map((row) => row.roomId);
  }

  async pruneRoomMessages(
    roomId: string,
    options?: PruneChatMessagesOptions,
  ): Promise<PruneChatMessagesResult> {
    return await this.db.transaction(async (tx) => {
      await this.lockRoom(tx, roomId);

      const index = await this.readChatIndex(roomId, tx);
      if (!index || index.latestMessages.length === 0) {
        return {
          deleted: 0,
          remaining: 0,
        };
      }

      const now = Date.now();
      const nextMessages = this.applyPrunePolicy(
        index.latestMessages,
        options,
        now,
      );

      const deleted = index.latestMessages.length - nextMessages.length;
      if (deleted <= 0) {
        return {
          deleted: 0,
          remaining: index.latestMessages.length,
        };
      }

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

      await tx.insert(chatEventsTable).values({
        roomId,
        seq: logRecord.seq,
        recordId: logRecord.recordId,
        timestamp: now,
        type: logRecord.type,
        messageSeq: null,
        record: logRecord,
      });

      await this.writeChatIndex(
        roomId,
        {
          roomId,
          createdAt: index.createdAt,
          updatedAt: now,
          nextSeq: Math.max(
            index.nextSeq,
            nextMessages.length === 0
              ? index.nextSeq
              : nextMessages[nextMessages.length - 1].seq + 1,
          ),
          logSeq: logRecord.seq,
          latestMessages: nextMessages,
        },
        tx,
      );

      return {
        deleted,
        remaining: nextMessages.length,
      };
    });
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) {
      return Math.min(this.defaultPageSize, this.maxPageSize);
    }

    return Math.min(this.maxPageSize, Math.max(1, Math.floor(limit)));
  }

  private resolveMaxMessages(maxMessages?: number): number {
    if (maxMessages !== undefined && Number.isFinite(maxMessages)) {
      return Math.max(0, Math.floor(maxMessages));
    }

    return Math.max(1, Math.floor(this.defaultMaxMessages));
  }

  private boundMessages(
    messages: ChatMessage[],
    maxMessages: number,
  ): ChatMessage[] {
    if (maxMessages <= 0) {
      return [];
    }

    if (messages.length <= maxMessages) {
      return messages;
    }

    return messages.slice(-maxMessages);
  }

  private applyPrunePolicy(
    messages: ChatMessage[],
    options:
      | {
          olderThanMs?: number | null;
          keepLatest?: number | null;
        }
      | undefined,
    pruneTimestamp: number,
  ): ChatMessage[] {
    let nextMessages = [...messages];

    if (
      options?.olderThanMs !== undefined &&
      options.olderThanMs !== null &&
      Number.isFinite(options.olderThanMs)
    ) {
      const cutoffTimestamp = pruneTimestamp - Number(options.olderThanMs);
      nextMessages = nextMessages.filter(
        (message) => message.createdAt >= cutoffTimestamp,
      );
    }

    if (
      options?.keepLatest !== undefined &&
      options.keepLatest !== null &&
      Number.isFinite(options.keepLatest)
    ) {
      const safeKeepLatest = Math.max(0, Math.floor(options.keepLatest));
      if (safeKeepLatest === 0) {
        nextMessages = [];
      } else if (nextMessages.length > safeKeepLatest) {
        nextMessages = nextMessages.slice(-safeKeepLatest);
      }
    }

    return nextMessages;
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

  private async readChatIndex(
    roomId: string,
    executor: PokerDb = this.db,
  ): Promise<PersistedChatIndex | null> {
    const rows = await executor
      .select()
      .from(chatIndexesTable)
      .where(eq(chatIndexesTable.roomId, roomId))
      .limit(1);
    if (rows[0]) {
      return {
        roomId: rows[0].roomId,
        createdAt: rows[0].createdAt,
        updatedAt: rows[0].updatedAt,
        nextSeq: rows[0].nextSeq,
        logSeq: rows[0].logSeq,
        latestMessages: rows[0].latestMessages,
      };
    }

    return await this.rebuildChatIndexFromLog(roomId, executor);
  }

  private async writeChatIndex(
    roomId: string,
    index: PersistedChatIndex,
    executor: PokerDb = this.db,
  ): Promise<void> {
    await executor
      .insert(chatIndexesTable)
      .values({
        roomId,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
        nextSeq: index.nextSeq,
        logSeq: index.logSeq,
        latestMessages: index.latestMessages,
      })
      .onConflictDoUpdate({
        target: chatIndexesTable.roomId,
        set: {
          createdAt: index.createdAt,
          updatedAt: index.updatedAt,
          nextSeq: index.nextSeq,
          logSeq: index.logSeq,
          latestMessages: index.latestMessages,
        },
      });
  }

  private async rebuildChatIndexFromLog(
    roomId: string,
    executor: PokerDb = this.db,
  ): Promise<PersistedChatIndex | null> {
    const rows = await executor
      .select({ record: chatEventsTable.record })
      .from(chatEventsTable)
      .where(eq(chatEventsTable.roomId, roomId))
      .orderBy(asc(chatEventsTable.seq));

    const records = rows.map((row) => row.record);
    if (records.length === 0) {
      return null;
    }

    const index = this.createEmptyIndex(roomId, records[0].timestamp);
    for (const record of records) {
      index.logSeq = record.seq;
      index.updatedAt = record.timestamp;

      if (record.type === 'MESSAGE_APPENDED') {
        index.latestMessages.push(record.message);
        index.latestMessages = this.boundMessages(
          index.latestMessages,
          this.resolveMaxMessages(),
        );
        index.nextSeq = Math.max(index.nextSeq, record.message.seq + 1);
        continue;
      }

      if (record.type === 'MESSAGES_PRUNED') {
        const nextMessages = this.applyPrunePolicy(
          index.latestMessages,
          record,
          record.timestamp,
        );

        index.latestMessages = nextMessages;
        index.nextSeq = Math.max(
          index.nextSeq,
          nextMessages.length === 0
            ? index.nextSeq
            : nextMessages[nextMessages.length - 1].seq + 1,
        );
        continue;
      }

      if (record.type === 'ROOM_CHAT_DELETED') {
        index.createdAt = record.timestamp;
        index.updatedAt = record.timestamp;
        index.nextSeq = 1;
        index.latestMessages = [];
      }
    }

    index.latestMessages = this.boundMessages(
      index.latestMessages,
      this.resolveMaxMessages(),
    );
    await this.writeChatIndex(roomId, index, executor);
    return index;
  }

  private async lockRoom(executor: PokerDb, roomId: string): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${roomId}))`,
    );
  }
}
