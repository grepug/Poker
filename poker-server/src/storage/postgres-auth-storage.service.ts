import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  AuthSessionRecord,
  AuthUserRecord,
  IAuthStorageService,
} from '../common/interfaces/auth-storage.interface';
import { DRIZZLE_DB } from '../db/database.constants';
import type { PokerDb } from '../db/database.module';
import { authSessionsTable, authUsersTable } from '../db/schema';

@Injectable()
export class PostgresAuthStorageService implements IAuthStorageService {
  private readonly logger = new Logger(PostgresAuthStorageService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: PokerDb) {}

  async getUsers(): Promise<AuthUserRecord[]> {
    const rows = await this.db
      .select()
      .from(authUsersTable)
      .orderBy(authUsersTable.createdAt, authUsersTable.id);
    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      displayName: row.displayName,
      avatarEmoji: row.avatarEmoji,
      passwordHash: row.passwordHash ?? undefined,
      passkeys: row.passkeys,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async replaceUsers(users: AuthUserRecord[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1001)`);

      const existingUsers = await tx.select().from(authUsersTable);
      const existingById = new Map(existingUsers.map((user) => [user.id, user]));
      const nextIds = new Set(users.map((user) => user.id));

      const removedIds = existingUsers
        .filter((user) => !nextIds.has(user.id))
        .map((user) => user.id);

      if (removedIds.length > 0) {
        await tx
          .delete(authUsersTable)
          .where(inArray(authUsersTable.id, removedIds));
      }

      for (const user of users) {
        const existing = existingById.get(user.id);
        if (
          existing &&
          this.authUserRecordsEqual(
            {
              ...existing,
              passwordHash: existing.passwordHash ?? undefined,
            },
            user,
          )
        ) {
          continue;
        }

        await tx
          .insert(authUsersTable)
          .values({
            id: user.id,
            accountId: user.accountId,
            displayName: user.displayName,
            avatarEmoji: user.avatarEmoji,
            passwordHash: user.passwordHash ?? null,
            passkeys: user.passkeys,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          })
          .onConflictDoUpdate({
            target: authUsersTable.id,
            set: {
              accountId: user.accountId,
              displayName: user.displayName,
              avatarEmoji: user.avatarEmoji,
              passwordHash: user.passwordHash ?? null,
              passkeys: user.passkeys,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
            },
          });
      }
    });
  }

  async getSessions(): Promise<AuthSessionRecord[]> {
    const rows = await this.db
      .select()
      .from(authSessionsTable)
      .orderBy(authSessionsTable.createdAt, authSessionsTable.tokenHash);
    return rows.map((row) => ({
      tokenHash: row.tokenHash,
      userId: row.userId,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    }));
  }

  async replaceSessions(sessions: AuthSessionRecord[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1002)`);

      const existingSessions = await tx.select().from(authSessionsTable);
      const existingByTokenHash = new Map(
        existingSessions.map((session) => [session.tokenHash, session]),
      );
      const nextTokenHashes = new Set(sessions.map((session) => session.tokenHash));

      const removedTokenHashes = existingSessions
        .filter((session) => !nextTokenHashes.has(session.tokenHash))
        .map((session) => session.tokenHash);

      if (removedTokenHashes.length > 0) {
        await tx
          .delete(authSessionsTable)
          .where(inArray(authSessionsTable.tokenHash, removedTokenHashes));
      }

      for (const session of sessions) {
        const existing = existingByTokenHash.get(session.tokenHash);
        if (existing && this.authSessionRecordsEqual(existing, session)) {
          continue;
        }

        await tx
          .insert(authSessionsTable)
          .values({
            tokenHash: session.tokenHash,
            userId: session.userId,
            expiresAt: session.expiresAt,
            lastUsedAt: session.lastUsedAt,
            createdAt: session.createdAt,
          })
          .onConflictDoUpdate({
            target: authSessionsTable.tokenHash,
            set: {
              userId: session.userId,
              expiresAt: session.expiresAt,
              lastUsedAt: session.lastUsedAt,
              createdAt: session.createdAt,
            },
          });
      }
    });
  }

  private authUserRecordsEqual(
    left: AuthUserRecord,
    right: AuthUserRecord,
  ): boolean {
    if (
      left.id !== right.id ||
      left.accountId !== right.accountId ||
      left.displayName !== right.displayName ||
      left.avatarEmoji !== right.avatarEmoji ||
      left.passwordHash !== right.passwordHash ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt ||
      left.passkeys.length !== right.passkeys.length
    ) {
      return false;
    }

    return left.passkeys.every((passkey, index) =>
      this.authPasskeysEqual(passkey, right.passkeys[index]),
    );
  }

  private authPasskeysEqual(
    left: AuthUserRecord['passkeys'][number],
    right: AuthUserRecord['passkeys'][number],
  ): boolean {
    const leftTransports = left.transports ?? [];
    const rightTransports = right.transports ?? [];

    return (
      left.credentialId === right.credentialId &&
      left.publicKey === right.publicKey &&
      left.counter === right.counter &&
      left.createdAt === right.createdAt &&
      left.updatedAt === right.updatedAt &&
      leftTransports.length === rightTransports.length &&
      leftTransports.every((transport, index) => transport === rightTransports[index])
    );
  }

  private authSessionRecordsEqual(
    left: AuthSessionRecord,
    right: AuthSessionRecord,
  ): boolean {
    return (
      left.tokenHash === right.tokenHash &&
      left.userId === right.userId &&
      left.expiresAt === right.expiresAt &&
      left.lastUsedAt === right.lastUsedAt &&
      left.createdAt === right.createdAt
    );
  }
}
