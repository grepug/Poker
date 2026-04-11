import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  AuthSessionRecord,
  AuthUserRecord,
} from '../common/interfaces/auth-storage.interface';
import type {
  PersistedChatIndex,
  PersistedChatLogRecord,
  PersistedRoomEventRecord,
  Room,
  SavedGameSummary,
} from 'poker-types';

export const roomEventsTable = pgTable(
  'room_events',
  {
    roomId: text('room_id').notNull(),
    seq: integer('seq').notNull(),
    recordId: text('record_id').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    handNumber: integer('hand_number'),
    street: text('street'),
    actor: jsonb('actor').$type<PersistedRoomEventRecord['actor']>(),
    payload: jsonb('payload').$type<PersistedRoomEventRecord['payload']>().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.seq] }),
    recordIdUnique: uniqueIndex('room_events_record_id_idx').on(table.recordId),
  }),
);

export const roomSnapshotsTable = pgTable('room_snapshots', {
  roomId: text('room_id').primaryKey(),
  lastRoomEventSeq: integer('last_room_event_seq').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  room: jsonb('room').$type<Room>().notNull(),
});

export const handEventsTable = pgTable(
  'hand_events',
  {
    roomId: text('room_id').notNull(),
    handNumber: integer('hand_number').notNull(),
    seq: integer('seq').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    event: jsonb('event').$type<PersistedRoomEventRecord>().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.handNumber, table.seq] }),
  }),
);

export const chatEventsTable = pgTable(
  'chat_events',
  {
    roomId: text('room_id').notNull(),
    seq: integer('seq').notNull(),
    recordId: text('record_id').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    messageSeq: integer('message_seq'),
    record: jsonb('record').$type<PersistedChatLogRecord>().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.seq] }),
    recordIdUnique: uniqueIndex('chat_events_record_id_idx').on(table.recordId),
  }),
);

export const chatIndexesTable = pgTable('chat_indexes', {
  roomId: text('room_id').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  nextSeq: integer('next_seq').notNull(),
  logSeq: integer('log_seq').notNull(),
  latestMessages: jsonb('latest_messages')
    .$type<PersistedChatIndex['latestMessages']>()
    .notNull(),
});

export const authUsersTable = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    displayName: text('display_name').notNull(),
    avatarEmoji: text('avatar_emoji').notNull(),
    passwordHash: text('password_hash'),
    passkeys: jsonb('passkeys').$type<AuthUserRecord['passkeys']>().notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    accountIdUnique: uniqueIndex('auth_users_account_id_idx').on(table.accountId),
  }),
);

export const authSessionsTable = pgTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const savedGameArchivesTable = pgTable('saved_game_archives', {
  archiveId: text('archive_id').primaryKey(),
  roomId: text('room_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  concludedAt: bigint('concluded_at', { mode: 'number' }).notNull(),
  handCount: integer('hand_count').notNull(),
  record: jsonb('record').$type<Record<string, unknown>>().notNull(),
});

export const savedGameUserIndexesTable = pgTable(
  'saved_game_user_indexes',
  {
    requesterUserId: text('requester_user_id').notNull(),
    archiveId: text('archive_id').notNull(),
    concludedAt: bigint('concluded_at', { mode: 'number' }).notNull(),
    summary: jsonb('summary').$type<SavedGameSummary>().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.requesterUserId, table.archiveId] }),
  }),
);

export const schema = {
  roomEventsTable,
  roomSnapshotsTable,
  handEventsTable,
  chatEventsTable,
  chatIndexesTable,
  authUsersTable,
  authSessionsTable,
  savedGameArchivesTable,
  savedGameUserIndexesTable,
};

export type PokerSchema = typeof schema;
