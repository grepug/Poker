import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AuthSessionRecord,
  AuthUserRecord,
  IAuthStorageService,
} from '../common/interfaces/auth-storage.interface';
import {
  PersistedAuthLogRecord,
  PersistedAuthState,
  PersistedAuthUserState,
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

@Injectable()
export class JsonAuthStorageService implements IAuthStorageService {
  private readonly logger = new Logger(JsonAuthStorageService.name);
  private readonly authDir: string;
  private readonly usersLegacyFilePath: string;
  private readonly sessionsLegacyFilePath: string;
  private readonly authLogPath: string;
  private readonly authStatePath: string;
  private readonly writeQueue = new Map<string, Promise<void>>();

  constructor(private readonly configService: ConfigService) {
    const dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.authDir = path.join(dataDir, 'auth');
    this.usersLegacyFilePath = path.join(this.authDir, 'users.json');
    this.sessionsLegacyFilePath = path.join(this.authDir, 'sessions.json');
    this.authLogPath = path.join(this.authDir, 'auth.jsonl');
    this.authStatePath = path.join(this.authDir, 'auth.state.json');
    this.ensureFiles().catch((error) => {
      this.logger.error(`Failed to initialize auth storage: ${error.message}`);
    });
  }

  async getUsers(): Promise<AuthUserRecord[]> {
    await this.ensureFiles();
    await this.migrateLegacyAuthIfNeeded();
    const state = await this.readAuthState();
    return (state?.users ?? []) as AuthUserRecord[];
  }

  async replaceUsers(users: AuthUserRecord[]): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureFiles();
      await this.migrateLegacyAuthIfNeeded();

      const state = (await this.readAuthState()) ?? this.createEmptyState();
      const previousUsersById = new Map(state.users.map((user) => [user.id, user]));
      const nextUsersById = new Map(users.map((user) => [user.id, user]));
      let nextSeq = state.lastLogSeq;
      const logRecords: PersistedAuthLogRecord[] = [];

      for (const user of users) {
        const previous = previousUsersById.get(user.id);
        if (JSON.stringify(previous) === JSON.stringify(user)) {
          continue;
        }

        logRecords.push({
          recordId: randomUUID(),
          seq: ++nextSeq,
          timestamp: user.updatedAt || user.createdAt || Date.now(),
          type: 'USER_UPSERTED',
          user: user as PersistedAuthUserState,
        });
      }

      for (const previousUser of state.users) {
        if (nextUsersById.has(previousUser.id)) {
          continue;
        }

        logRecords.push({
          recordId: randomUUID(),
          seq: ++nextSeq,
          timestamp: Date.now(),
          type: 'USER_REMOVED',
          userId: previousUser.id,
        });
      }

      if (logRecords.length > 0) {
        await appendJsonlRecords(this.authLogPath, logRecords);
      }

      await this.writeAuthState({
        lastLogSeq: nextSeq,
        updatedAt: Date.now(),
        users: users as PersistedAuthUserState[],
        sessions: state.sessions,
      });
    });
  }

  async getSessions(): Promise<AuthSessionRecord[]> {
    await this.ensureFiles();
    await this.migrateLegacyAuthIfNeeded();
    const state = await this.readAuthState();
    return state?.sessions ?? [];
  }

  async replaceSessions(sessions: AuthSessionRecord[]): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.ensureFiles();
      await this.migrateLegacyAuthIfNeeded();

      const state = (await this.readAuthState()) ?? this.createEmptyState();
      const previousSessionsByTokenHash = new Map(
        state.sessions.map((session) => [session.tokenHash, session]),
      );
      const nextSessionsByTokenHash = new Map(
        sessions.map((session) => [session.tokenHash, session]),
      );
      let nextSeq = state.lastLogSeq;
      const logRecords: PersistedAuthLogRecord[] = [];

      for (const session of sessions) {
        const previous = previousSessionsByTokenHash.get(session.tokenHash);
        if (JSON.stringify(previous) === JSON.stringify(session)) {
          continue;
        }

        logRecords.push({
          recordId: randomUUID(),
          seq: ++nextSeq,
          timestamp: session.lastUsedAt || session.createdAt || Date.now(),
          type: 'SESSION_UPSERTED',
          session,
        });
      }

      for (const previousSession of state.sessions) {
        if (nextSessionsByTokenHash.has(previousSession.tokenHash)) {
          continue;
        }

        logRecords.push({
          recordId: randomUUID(),
          seq: ++nextSeq,
          timestamp: Date.now(),
          type: 'SESSION_REMOVED',
          tokenHash: previousSession.tokenHash,
        });
      }

      if (logRecords.length > 0) {
        await appendJsonlRecords(this.authLogPath, logRecords);
      }

      await this.writeAuthState({
        lastLogSeq: nextSeq,
        updatedAt: Date.now(),
        users: state.users,
        sessions,
      });
    });
  }

  private async ensureFiles(): Promise<void> {
    await ensureDir(this.authDir);
  }

  private async enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const queueKey = this.authLogPath;
    const previous = this.writeQueue.get(queueKey) ?? Promise.resolve();
    let releaseCurrent: (() => void) | null = null;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.writeQueue.set(queueKey, current);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent?.();
      if (this.writeQueue.get(queueKey) === current) {
        this.writeQueue.delete(queueKey);
      }
    }
  }

  private createEmptyState(): PersistedAuthState {
    return {
      lastLogSeq: 0,
      updatedAt: Date.now(),
      users: [],
      sessions: [],
    };
  }

  private async readAuthState(): Promise<PersistedAuthState | null> {
    try {
      const state = await readJsonFile<PersistedAuthState>(this.authStatePath);
      if (state) {
        return state;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read auth state, rebuilding from log: ${(error as Error).message}`,
      );
    }

    return await this.rebuildAuthStateFromLog();
  }

  private async writeAuthState(state: PersistedAuthState): Promise<void> {
    await writeJsonFileAtomic(this.authStatePath, state);
  }

  private async rebuildAuthStateFromLog(): Promise<PersistedAuthState | null> {
    const records = await readJsonlRecords<PersistedAuthLogRecord>(this.authLogPath);
    if (records.length === 0) {
      return null;
    }

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
        case 'AUTH_MIGRATED':
          break;
      }
    }

    const state: PersistedAuthState = {
      lastLogSeq: records[records.length - 1].seq,
      updatedAt: records[records.length - 1].timestamp,
      users: [...usersById.values()],
      sessions: [...sessionsByTokenHash.values()],
    };
    await this.writeAuthState(state);
    return state;
  }

  private async migrateLegacyAuthIfNeeded(): Promise<void> {
    const hasUsersLegacy = await pathExists(this.usersLegacyFilePath);
    const hasSessionsLegacy = await pathExists(this.sessionsLegacyFilePath);
    const hasState = await pathExists(this.authStatePath);
    const hasLog = await pathExists(this.authLogPath);
    if (!hasUsersLegacy && !hasSessionsLegacy) {
      return;
    }

    if (hasState || hasLog) {
      const cleanedUp = await this.cleanupLegacyAuthIfJsonlReady(hasState, hasLog);
      if (!cleanedUp) {
        this.logger.warn(
          'Skipping legacy auth cleanup because the JSONL layout is only partially present',
        );
      }
      return;
    }

    const users =
      (await readJsonFile<AuthUserRecord[]>(this.usersLegacyFilePath)) ?? [];
    const sessions =
      (await readJsonFile<AuthSessionRecord[]>(this.sessionsLegacyFilePath)) ?? [];
    let seq = 0;
    const migratedAt = Date.now();
    const logRecords: PersistedAuthLogRecord[] = [
      {
        recordId: randomUUID(),
        seq: ++seq,
        timestamp: migratedAt,
        type: 'AUTH_MIGRATED',
        userCount: users.length,
        sessionCount: sessions.length,
      },
      ...users.map((user) => ({
        recordId: randomUUID(),
        seq: ++seq,
        timestamp: user.updatedAt || user.createdAt || migratedAt,
        type: 'USER_UPSERTED' as const,
        user: user as PersistedAuthUserState,
      })),
      ...sessions.map((session) => ({
        recordId: randomUUID(),
        seq: ++seq,
        timestamp: session.lastUsedAt || session.createdAt || migratedAt,
        type: 'SESSION_UPSERTED' as const,
        session,
      })),
    ];

    await appendJsonlRecords(this.authLogPath, logRecords);
    await this.writeAuthState({
      lastLogSeq: seq,
      updatedAt: migratedAt,
      users: users as PersistedAuthUserState[],
      sessions,
    });
    await fs.rm(this.usersLegacyFilePath, { force: true });
    await fs.rm(this.sessionsLegacyFilePath, { force: true });
    this.logger.log('Migrated legacy auth JSON files to JSONL auth ledger');
  }

  private async cleanupLegacyAuthIfJsonlReady(
    hasState: boolean,
    hasLog: boolean,
  ): Promise<boolean> {
    if (!hasLog) {
      return false;
    }

    await readJsonlRecords<PersistedAuthLogRecord>(this.authLogPath);
    if (hasState) {
      await readJsonFile<PersistedAuthState>(this.authStatePath);
    } else {
      await this.rebuildAuthStateFromLog();
    }

    await fs.rm(this.usersLegacyFilePath, { force: true });
    await fs.rm(this.sessionsLegacyFilePath, { force: true });
    this.logger.log('Removed legacy auth JSON files after confirming JSONL auth storage');
    return true;
  }
}
