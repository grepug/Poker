import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Pool } from 'pg';
import { runBackfill } from '../../scripts/backfill-json-to-db';

const TEST_ADMIN_DATABASE_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  `postgres://postgres:postgres@127.0.0.1:${process.env.PG_TEST_PORT ?? '55432'}/postgres`;

describe('runBackfill', () => {
  let adminPool: Pool;
  let databaseName: string;
  let databaseUrl: string;
  let dataDir: string;
  let previousOverwriteFlag: string | undefined;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: TEST_ADMIN_DATABASE_URL });

    try {
      await adminPool.query('select 1');
    } catch (error) {
      await adminPool.end();
      throw new Error(
        `Backfill integration test requires PostgreSQL at ${TEST_ADMIN_DATABASE_URL}: ${(error as Error).message}`,
      );
    }
  });

  beforeEach(async () => {
    databaseName = `poker_backfill_${randomUUID().replace(/-/g, '')}`;
    databaseUrl = buildDatabaseUrl(databaseName);
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poker-backfill-'));
    previousOverwriteFlag = process.env.DB_BACKFILL_OVERWRITE;
    delete process.env.DB_BACKFILL_OVERWRITE;

    await adminPool.query(`create database ${databaseName}`);
    await seedLegacyData(dataDir);
  });

  afterEach(async () => {
    if (previousOverwriteFlag === undefined) {
      delete process.env.DB_BACKFILL_OVERWRITE;
    } else {
      process.env.DB_BACKFILL_OVERWRITE = previousOverwriteFlag;
    }

    await adminPool.query(`drop database if exists ${databaseName} with (force)`);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await adminPool.end();
  });

  it('backfills the JSON room, chat, auth, and saved-game stores into Postgres', async () => {
    await runBackfill({
      connectionString: databaseUrl,
      dataDir,
    });

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const roomEvents = await scalarCount(
        pool,
        `select count(*)::int as count from room_events where room_id = 'ROOM123'`,
      );
      const handEvents = await scalarCount(
        pool,
        `select count(*)::int as count from hand_events where room_id = 'ROOM123'`,
      );
      const chatEvents = await scalarCount(
        pool,
        `select count(*)::int as count from chat_events where room_id = 'ROOM123'`,
      );
      const authUsers = await scalarCount(
        pool,
        `select count(*)::int as count from auth_users`,
      );
      const authSessions = await scalarCount(
        pool,
        `select count(*)::int as count from auth_sessions`,
      );
      const savedArchives = await scalarCount(
        pool,
        `select count(*)::int as count from saved_game_archives`,
      );
      const savedIndexes = await scalarCount(
        pool,
        `select count(*)::int as count from saved_game_user_indexes`,
      );

      const roomSnapshot = await pool.query<{
        last_room_event_seq: number;
        room_id: string;
      }>(
        `select room_id, last_room_event_seq from room_snapshots where room_id = 'ROOM123'`,
      );
      const chatIndex = await pool.query<{
        next_seq: number;
        log_seq: number;
      }>(
        `select next_seq, log_seq from chat_indexes where room_id = 'ROOM123'`,
      );
      const savedArchive = await pool.query<{ room_id: string; hand_count: number }>(
        `select room_id, hand_count from saved_game_archives where archive_id = 'archive-1'`,
      );

      expect(roomEvents).toBe(2);
      expect(handEvents).toBe(1);
      expect(chatEvents).toBe(2);
      expect(authUsers).toBe(1);
      expect(authSessions).toBe(1);
      expect(savedArchives).toBe(1);
      expect(savedIndexes).toBe(1);
      expect(roomSnapshot.rows).toEqual([
        {
          room_id: 'ROOM123',
          last_room_event_seq: 2,
        },
      ]);
      expect(chatIndex.rows).toEqual([
        {
          next_seq: 2,
          log_seq: 2,
        },
      ]);
      expect(savedArchive.rows).toEqual([
        {
          room_id: 'ROOM123',
          hand_count: 1,
        },
      ]);
    } finally {
      await pool.end();
    }
  });

  it('refuses to overwrite a populated database unless DB_BACKFILL_OVERWRITE=true', async () => {
    await runBackfill({
      connectionString: databaseUrl,
      dataDir,
    });

    await expect(
      runBackfill({
        connectionString: databaseUrl,
        dataDir,
      }),
    ).rejects.toThrow(/refused to overwrite populated Postgres tables/);
  });
});

function buildDatabaseUrl(databaseName: string): string {
  const adminUrl = new URL(TEST_ADMIN_DATABASE_URL);
  adminUrl.pathname = `/${databaseName}`;
  return adminUrl.toString();
}

async function scalarCount(pool: Pool, query: string): Promise<number> {
  const result = await pool.query<{ count: number }>(query);
  return Number(result.rows[0]?.count ?? 0);
}

async function seedLegacyData(dataDir: string): Promise<void> {
  const roomId = 'ROOM123';
  const roomState = {
    id: roomId,
    hostId: 'user-1',
    config: {
      startingChips: 1000,
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      reconnectGracePeriod: 30000,
      allowPlayerStreetReveal: true,
    },
    players: [
      {
        id: 'alice-player',
        userId: 'user-1',
        socketId: 'socket-1',
        name: 'Alice',
        emoji: ':fox:',
        chips: 1020,
        totalBuyIn: 1000,
        handsPlayedCount: 1,
        handsWonCount: 1,
        vpipHandsCount: 1,
        position: 0,
        status: 'connected',
        cards: null,
        currentBet: 0,
        lastAction: null,
        lastConnectedAt: 1000,
      },
      {
        id: 'bob-player',
        userId: 'user-2',
        socketId: 'socket-2',
        name: 'Bob',
        emoji: ':bear:',
        chips: 980,
        totalBuyIn: 1000,
        handsPlayedCount: 1,
        handsWonCount: 0,
        vpipHandsCount: 1,
        position: 1,
        status: 'connected',
        cards: null,
        currentBet: 0,
        lastAction: null,
        lastConnectedAt: 1000,
      },
    ],
    gameState: 'ENDED',
    currentHand: null,
    createdAt: 900,
    lastActivityAt: 1100,
  };

  await writeJsonl(path.join(dataDir, 'rooms', roomId, 'room-events.jsonl'), [
    {
      recordId: 'room-event-1',
      seq: 1,
      roomId,
      handNumber: 1,
      street: 'PRE_FLOP',
      timestamp: 1000,
      type: 'HAND_STARTED',
      actor: { source: 'HAND_SERVICE' },
      payload: {
        handNumber: 1,
      },
    },
    {
      recordId: 'room-event-2',
      seq: 2,
      roomId,
      handNumber: null,
      street: null,
      timestamp: 1100,
      type: 'ROOM_STATE_UPDATED',
      actor: { source: 'SYSTEM' },
      payload: {
        room: roomState,
      },
    },
  ]);
  await writeJson(path.join(dataDir, 'rooms', roomId, 'room.snapshot.json'), {
    snapshot: {
      lastRoomEventSeq: 2,
      updatedAt: 1100,
    },
    room: roomState,
  });

  await writeJsonl(path.join(dataDir, 'chat', roomId, 'messages.jsonl'), [
    {
      recordId: 'chat-event-1',
      seq: 1,
      roomId,
      timestamp: 1005,
      type: 'CHAT_MIGRATED',
      messageCount: 1,
    },
    {
      recordId: 'chat-event-2',
      seq: 2,
      roomId,
      timestamp: 1010,
      type: 'MESSAGE_APPENDED',
      message: {
        id: 'message-1',
        roomId,
        seq: 1,
        kind: 'TEXT',
        text: 'hello from legacy chat',
        clientMessageId: 'client-1',
        createdAt: 1010,
        sender: {
          playerId: 'alice-player',
          playerName: 'Alice',
          avatarEmoji: ':fox:',
        },
      },
    },
  ]);
  await writeJson(path.join(dataDir, 'chat', roomId, 'chat.index.json'), {
    roomId,
    createdAt: 1005,
    updatedAt: 1010,
    nextSeq: 2,
    logSeq: 2,
    latestMessages: [
      {
        id: 'message-1',
        roomId,
        seq: 1,
        kind: 'TEXT',
        text: 'hello from legacy chat',
        clientMessageId: 'client-1',
        createdAt: 1010,
        sender: {
          playerId: 'alice-player',
          playerName: 'Alice',
          avatarEmoji: ':fox:',
        },
      },
    ],
  });

  await writeJson(path.join(dataDir, 'auth', 'auth.state.json'), {
    lastLogSeq: 2,
    updatedAt: 1020,
    users: [
      {
        id: 'user-1',
        accountId: 'test1',
        displayName: 'Alice',
        avatarEmoji: ':fox:',
        passwordHash: 'hash-1',
        passkeys: [],
        createdAt: 950,
        updatedAt: 1020,
      },
    ],
    sessions: [
      {
        tokenHash: 'token-1',
        userId: 'user-1',
        expiresAt: 999999,
        lastUsedAt: 1020,
        createdAt: 1000,
      },
    ],
  });

  await writeJson(
    path.join(dataDir, 'saved-games', 'archives', 'archive-1.json'),
    {
      archiveId: 'archive-1',
      roomId,
      createdAt: 1200,
      startedAt: 900,
      concludedAt: 1200,
      handCount: 1,
      blinds: {
        smallBlind: 5,
        bigBlind: 10,
      },
      participants: [
        {
          playerId: 'alice-player',
          userId: 'user-1',
          playerName: 'Alice',
          isRobot: false,
          totalBuyIn: 1000,
          finalChips: 1020,
          profit: 20,
        },
      ],
      playerViews: {
        'user-1': {
          requesterUserId: 'user-1',
          requesterPlayerId: 'alice-player',
          hands: [
            {
              handNumber: 1,
              history: {
                handNumber: 1,
              },
              analysis: {
                status: 'pending',
                updatedAt: 1200,
                localizedByLocale: {},
              },
            },
          ],
        },
      },
    },
  );
  await writeJson(path.join(dataDir, 'saved-games', 'users', 'user-1.json'), [
    {
      archiveId: 'archive-1',
      roomId,
      requesterUserId: 'user-1',
      requesterPlayerId: 'alice-player',
      createdAt: 1200,
      startedAt: 900,
      concludedAt: 1200,
      handCount: 1,
      blinds: {
        smallBlind: 5,
        bigBlind: 10,
      },
      participants: [
        {
          playerId: 'alice-player',
          userId: 'user-1',
          playerName: 'Alice',
          isRobot: false,
          totalBuyIn: 1000,
          finalChips: 1020,
          profit: 20,
        },
      ],
    },
  ]);
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

async function writeJsonl(
  filePath: string,
  records: Array<Record<string, unknown>>,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await fs.writeFile(filePath, body, 'utf-8');
}
