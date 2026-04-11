import type { Dirent } from 'node:fs';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import type {
  PersistedAuthLogRecord,
  PersistedAuthState,
  PersistedAuthUserState,
  PersistedChatIndex,
  PersistedChatLogRecord,
  PersistedRoomEventRecord,
  Room,
} from 'poker-types';
import type {
  AuthSessionRecord,
  AuthUserRecord,
} from '../src/common/interfaces/auth-storage.interface';
import {
  authSessionsTable,
  authUsersTable,
  chatEventsTable,
  chatIndexesTable,
  handEventsTable,
  roomEventsTable,
  roomSnapshotsTable,
  savedGameArchivesTable,
  savedGameUserIndexesTable,
  schema,
} from '../src/db/schema';
import {
  parseJsonlRecords,
  readJsonFile,
} from '../src/storage/jsonl-store.util';
import type {
  SavedGameArchiveRecord,
  StoredRoomProjection,
} from '../src/storage/postgres-storage.types';

type LegacyChatRoomData = {
  roomId: string;
  createdAt: number;
  updatedAt: number;
  nextSeq: number;
  messages: PersistedChatIndex['latestMessages'];
};

type BackfillExecutor = any;

const serverRoot = path.resolve(__dirname, '..');

async function main() {
  loadRepoEnv();

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for db:backfill');
  }

  const dataDir = path.resolve(serverRoot, process.env.DATA_DIR || './data');
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    const migrationsFolder = resolveMigrationsFolder();
    if (!migrationsFolder) {
      throw new Error('Unable to resolve Drizzle migrations folder for db:backfill');
    }

    await migrate(db, { migrationsFolder });

    await db.transaction(async (tx) => {
      await assertBackfillTargetIsSafe(tx);

      await tx.execute(sql`
        truncate table
          saved_game_user_indexes,
          saved_game_archives,
          auth_sessions,
          auth_users,
          chat_indexes,
          chat_events,
          hand_events,
          room_snapshots,
          room_events
        restart identity
      `);

      await backfillRooms(tx, dataDir);
      await backfillChat(tx, dataDir);
      await backfillAuth(tx, dataDir);
      await backfillSavedGames(tx, dataDir);
    });

    console.log(`Backfill complete from ${dataDir}`);
  } finally {
    await pool.end();
  }
}

async function assertBackfillTargetIsSafe(db: BackfillExecutor): Promise<void> {
  const overwriteAllowed = process.env.DB_BACKFILL_OVERWRITE === 'true';
  if (overwriteAllowed) {
    return;
  }

  const populatedTables: string[] = [];
  for (const [tableName, table] of [
    ['room_events', roomEventsTable],
    ['room_snapshots', roomSnapshotsTable],
    ['hand_events', handEventsTable],
    ['chat_events', chatEventsTable],
    ['chat_indexes', chatIndexesTable],
    ['auth_users', authUsersTable],
    ['auth_sessions', authSessionsTable],
    ['saved_game_archives', savedGameArchivesTable],
    ['saved_game_user_indexes', savedGameUserIndexesTable],
  ] as const) {
    const populated = await hasRows(db, tableName, table);
    if (populated) {
      populatedTables.push(populated);
    }
  }
  populatedTables.sort();

  if (populatedTables.length === 0) {
    return;
  }

  throw new Error(
    `db:backfill refused to overwrite populated Postgres tables: ${populatedTables.join(
      ', ',
    )}. Re-run with DB_BACKFILL_OVERWRITE=true if replacement is intentional.`,
  );
}

async function hasRows(
  db: BackfillExecutor,
  tableName: string,
  table: any,
): Promise<string | null> {
  const result = await db
    .select({ present: sql<number>`1` })
    .from(table)
    .limit(1);
  return result.length > 0 ? tableName : null;
}

async function backfillRooms(db: BackfillExecutor, dataDir: string) {
  const roomsDir = path.join(dataDir, 'rooms');
  const entries = await safeReadDir(roomsDir);
  const roomIds = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      roomIds.add(entry.name);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      roomIds.add(entry.name.replace(/\.json$/, ''));
    }
  }

  for (const roomId of roomIds) {
    const roomDir = path.join(roomsDir, roomId);
    const legacyRoomPath = path.join(roomsDir, `${roomId}.json`);
    const roomEventsPath = path.join(roomDir, 'room-events.jsonl');
    const projectionPath = path.join(roomDir, 'room.snapshot.json');

    let roomEvents =
      (await readJsonlFile<PersistedRoomEventRecord>(roomEventsPath)) ?? [];
    let projection =
      (await readJsonFile<StoredRoomProjection>(projectionPath)) ?? null;

    if (roomEvents.length === 0) {
      const legacyRoom = await readJsonFile<Room>(legacyRoomPath);
      if (!legacyRoom) {
        continue;
      }

      const migratedAt = Number(
        legacyRoom.lastActivityAt || legacyRoom.createdAt || Date.now(),
      );
      roomEvents = [
        {
          recordId: randomUUID(),
          seq: 1,
          roomId,
          handNumber: legacyRoom.currentHand?.handNumber ?? null,
          street: legacyRoom.currentHand?.bettingRound ?? null,
          timestamp: migratedAt,
          type: 'ROOM_MIGRATED',
          actor: { source: 'MIGRATION' },
          payload: {
            legacyPath: legacyRoomPath,
          },
        },
        {
          recordId: randomUUID(),
          seq: 2,
          roomId,
          handNumber: legacyRoom.currentHand?.handNumber ?? null,
          street: legacyRoom.currentHand?.bettingRound ?? null,
          timestamp: migratedAt,
          type: 'ROOM_STATE_UPDATED',
          actor: { source: 'MIGRATION' },
          payload: {
            room: legacyRoom,
          },
        },
      ];
      projection = {
        snapshot: {
          lastRoomEventSeq: 2,
          updatedAt: migratedAt,
        },
        room: legacyRoom,
      };
    }

    if (!projection) {
      const latestSnapshot = [...roomEvents]
        .reverse()
        .find((event) => event.type === 'ROOM_STATE_UPDATED');
      const room = latestSnapshot?.payload.room as Room | undefined;
      if (!room) {
        continue;
      }
      projection = {
        snapshot: {
          lastRoomEventSeq: roomEvents[roomEvents.length - 1]?.seq ?? 0,
          updatedAt: latestSnapshot.timestamp,
        },
        room,
      };
    }

    if (roomEvents.length > 0) {
      await db.insert(roomEventsTable).values(
        roomEvents.map((event) => ({
          roomId: event.roomId,
          seq: event.seq,
          recordId: event.recordId,
          timestamp: event.timestamp,
          type: event.type,
          handNumber: event.handNumber ?? null,
          street: event.street ?? null,
          actor: event.actor ?? null,
          payload: event.payload,
        })),
      );

      const handEvents = roomEvents.filter(
        (event) => event.handNumber && event.type !== 'ROOM_STATE_UPDATED',
      );
      if (handEvents.length > 0) {
        await db.insert(handEventsTable).values(
          handEvents.map((event) => ({
            roomId: event.roomId,
            handNumber: event.handNumber!,
            seq: event.seq,
            timestamp: event.timestamp,
            type: event.type,
            event,
          })),
        );
      }
    }

    await db.insert(roomSnapshotsTable).values({
      roomId,
      lastRoomEventSeq: projection.snapshot.lastRoomEventSeq,
      updatedAt: projection.snapshot.updatedAt,
      room: projection.room,
    });
  }
}

async function backfillChat(db: BackfillExecutor, dataDir: string) {
  const chatDir = path.join(dataDir, 'chat');
  const entries = await safeReadDir(chatDir);
  const roomIds = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      roomIds.add(entry.name);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      roomIds.add(entry.name.replace(/\.json$/, ''));
    }
  }

  for (const roomId of roomIds) {
    const roomDir = path.join(chatDir, roomId);
    const logPath = path.join(roomDir, 'messages.jsonl');
    const indexPath = path.join(roomDir, 'chat.index.json');
    const legacyPath = path.join(chatDir, `${roomId}.json`);

    let records =
      (await readJsonlFile<PersistedChatLogRecord>(logPath)) ?? [];
    let index = await readJsonFile<PersistedChatIndex>(indexPath);

    if (records.length === 0) {
      const legacy = await readJsonFile<LegacyChatRoomData>(legacyPath);
      if (!legacy) {
        continue;
      }

      const normalizedMessages = [...legacy.messages].sort((left, right) => {
        if (left.seq !== right.seq) {
          return left.seq - right.seq;
        }
        return left.createdAt - right.createdAt;
      });
      const highestSeq = normalizedMessages.reduce(
        (max, message) => Math.max(max, message.seq),
        0,
      );
      let seq = 0;
      const migratedAt = Number(legacy.updatedAt || legacy.createdAt || Date.now());
      records = [
        {
          recordId: randomUUID(),
          seq: ++seq,
          roomId,
          timestamp: migratedAt,
          type: 'CHAT_MIGRATED',
          messageCount: normalizedMessages.length,
        },
        ...normalizedMessages.map((message) => ({
          recordId: randomUUID(),
          seq: ++seq,
          roomId,
          timestamp: message.createdAt,
          type: 'MESSAGE_APPENDED' as const,
          message,
        })),
      ];
      index = {
        roomId,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        nextSeq: Math.max(
          typeof legacy.nextSeq === 'number' && legacy.nextSeq > 0
            ? legacy.nextSeq
            : 1,
          highestSeq + 1,
        ),
        logSeq: seq,
        latestMessages: normalizedMessages.slice(-200),
      };
    }

    if (!index && records.length > 0) {
      index = rebuildChatIndexFromLog(roomId, records);
    }

    if (records.length > 0) {
      await db.insert(chatEventsTable).values(
        records.map((record) => ({
          roomId: record.roomId,
          seq: record.seq,
          recordId: record.recordId,
          timestamp: record.timestamp,
          type: record.type,
          messageSeq: record.type === 'MESSAGE_APPENDED' ? record.message.seq : null,
          record,
        })),
      );
    }

    if (index) {
      await db.insert(chatIndexesTable).values({
        roomId: index.roomId,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
        nextSeq: index.nextSeq,
        logSeq: index.logSeq,
        latestMessages: index.latestMessages,
      });
    }
  }
}

async function backfillAuth(db: BackfillExecutor, dataDir: string) {
  const authDir = path.join(dataDir, 'auth');
  const authStatePath = path.join(authDir, 'auth.state.json');
  const authLogPath = path.join(authDir, 'auth.jsonl');
  const usersLegacyPath = path.join(authDir, 'users.json');
  const sessionsLegacyPath = path.join(authDir, 'sessions.json');

  let state = await readJsonFile<PersistedAuthState>(authStatePath);
  if (!state) {
    const logRecords = await readJsonlFile<PersistedAuthLogRecord>(authLogPath);
    if (logRecords && logRecords.length > 0) {
      state = rebuildAuthStateFromLog(logRecords);
    }
  }

  if (!state) {
    const users = (await readJsonFile<AuthUserRecord[]>(usersLegacyPath)) ?? [];
    const sessions =
      (await readJsonFile<AuthSessionRecord[]>(sessionsLegacyPath)) ?? [];
    state = {
      lastLogSeq: 0,
      updatedAt: Date.now(),
      users: users as PersistedAuthUserState[],
      sessions,
    };
  }

  if (state.users.length > 0) {
    await db.insert(authUsersTable).values(
      state.users.map((user) => ({
        id: user.id,
        accountId: user.accountId,
        displayName: user.displayName,
        avatarEmoji: user.avatarEmoji,
        passwordHash: user.passwordHash ?? null,
        passkeys: user.passkeys,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
    );
  }

  if (state.sessions.length > 0) {
    await db.insert(authSessionsTable).values(
      state.sessions.map((session) => ({
        tokenHash: session.tokenHash,
        userId: session.userId,
        expiresAt: session.expiresAt,
        lastUsedAt: session.lastUsedAt,
        createdAt: session.createdAt,
      })),
    );
  }
}

async function backfillSavedGames(
  db: BackfillExecutor,
  dataDir: string,
) {
  const archivesDir = path.join(dataDir, 'saved-games', 'archives');
  const usersDir = path.join(dataDir, 'saved-games', 'users');

  for (const entry of await safeReadDir(archivesDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const archive = await readJsonFile<SavedGameArchiveRecord>(
      path.join(archivesDir, entry.name),
    );
    if (!archive) {
      continue;
    }

    await db.insert(savedGameArchivesTable).values({
      archiveId: archive.archiveId,
      roomId: archive.roomId,
      createdAt: archive.createdAt,
      startedAt: archive.startedAt,
      concludedAt: archive.concludedAt,
      handCount: archive.handCount,
      record: archive as unknown as Record<string, unknown>,
    });
  }

  for (const entry of await safeReadDir(usersDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const summaries = await readJsonFile<any[]>(path.join(usersDir, entry.name));
    if (!summaries) {
      continue;
    }

    for (const summary of summaries) {
      await db.insert(savedGameUserIndexesTable).values({
        requesterUserId: summary.requesterUserId,
        archiveId: summary.archiveId,
        concludedAt: summary.concludedAt,
        summary,
      });
    }
  }
}

function rebuildAuthStateFromLog(
  records: PersistedAuthLogRecord[],
): PersistedAuthState {
  const usersById = new Map<string, PersistedAuthUserState>();
  const sessionsByTokenHash = new Map<string, AuthSessionRecord>();

  for (const record of records) {
    switch (record.type) {
      case 'USER_UPSERTED':
        usersById.set(record.user.id, record.user);
        break;
      case 'USER_REMOVED':
        usersById.delete(record.userId);
        break;
      case 'SESSION_UPSERTED':
        sessionsByTokenHash.set(record.session.tokenHash, record.session);
        break;
      case 'SESSION_REMOVED':
        sessionsByTokenHash.delete(record.tokenHash);
        break;
      default:
        break;
    }
  }

  const last = records[records.length - 1];
  return {
    lastLogSeq: last?.seq ?? 0,
    updatedAt: last?.timestamp ?? Date.now(),
    users: [...usersById.values()],
    sessions: [...sessionsByTokenHash.values()],
  };
}

function rebuildChatIndexFromLog(
  roomId: string,
  records: PersistedChatLogRecord[],
): PersistedChatIndex {
  const index: PersistedChatIndex = {
    roomId,
    createdAt: records[0]?.timestamp ?? Date.now(),
    updatedAt: records[0]?.timestamp ?? Date.now(),
    nextSeq: 1,
    logSeq: 0,
    latestMessages: [],
  };

  for (const record of records) {
    index.logSeq = record.seq;
    index.updatedAt = record.timestamp;

    if (record.type === 'MESSAGE_APPENDED') {
      index.latestMessages.push(record.message);
      index.latestMessages = index.latestMessages.slice(-200);
      index.nextSeq = Math.max(index.nextSeq, record.message.seq + 1);
      continue;
    }

    if (record.type === 'ROOM_CHAT_DELETED') {
      index.createdAt = record.timestamp;
      index.updatedAt = record.timestamp;
      index.nextSeq = 1;
      index.latestMessages = [];
    }
  }

  return index;
}

async function readJsonlFile<T>(filePath: string): Promise<T[] | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseJsonlRecords<T extends Record<string, unknown> ? T : never>(
      raw,
    ) as T[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function safeReadDir(dirPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function loadRepoEnv(): void {
  const envPath = path.resolve(serverRoot, '..', '.env');
  process.loadEnvFile?.(envPath);
}

function resolveMigrationsFolder(): string | null {
  const candidates = [
    path.resolve(serverRoot, 'drizzle'),
    path.resolve(serverRoot, '../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];

  return (
    candidates.find((candidate) => existsSync(path.join(candidate, 'meta'))) ??
    null
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
