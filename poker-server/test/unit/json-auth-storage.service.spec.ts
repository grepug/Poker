import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { JsonAuthStorageService } from '../../src/storage/json-auth-storage.service';

describe('JsonAuthStorageService', () => {
  let service: JsonAuthStorageService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'poker-auth-storage-'));
    const configService = {
      get: (key: string) => {
        if (key === 'DATA_DIR') return tempDir;
        return undefined;
      },
    } as any;

    service = new JsonAuthStorageService(configService);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists and loads users + sessions', async () => {
    await service.replaceUsers([
      {
        id: 'user-1',
        accountId: 'test1',
        displayName: 'Alice',
        avatarEmoji: '🦊',
        passkeys: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    await service.replaceSessions([
      {
        tokenHash: 'token-hash-1',
        userId: 'user-1',
        createdAt: 1,
        lastUsedAt: 1,
        expiresAt: 999999,
      },
    ]);

    const users = await service.getUsers();
    const sessions = await service.getSessions();

    expect(users).toHaveLength(1);
    expect(users[0].accountId).toBe('test1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe('token-hash-1');
  });

  it('keeps auth state valid under concurrent saves', async () => {
    await Promise.all(
      Array.from({ length: 20 }).map((_, index) =>
        service.replaceSessions([
          {
            tokenHash: `token-hash-${index}`,
            userId: `user-${index}`,
            createdAt: index,
            lastUsedAt: index,
            expiresAt: index + 1000,
          },
        ]),
      ),
    );

    const sessionsPath = path.join(tempDir, 'auth', 'auth.state.json');
    const raw = await readFile(sessionsPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(parsed.sessions).toHaveLength(1);
    expect(typeof parsed.sessions[0].tokenHash).toBe('string');
  });

  it('continues queued writes after a failed serialization', async () => {
    const circular: any = {};
    circular.self = circular;
    const failingWrite = service.replaceUsers([circular]);

    const succeedingWrite = service.replaceUsers([
      {
        id: 'user-ok',
        accountId: 'test-ok',
        displayName: 'ok',
        avatarEmoji: '🙂',
        passkeys: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await expect(failingWrite).rejects.toThrow();
    await expect(succeedingWrite).resolves.toBeUndefined();

    const users = await service.getUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('user-ok');
  });

  it('rebuilds auth state from the auth log when the state snapshot is missing', async () => {
    await service.replaceUsers([
      {
        id: 'user-1',
        accountId: 'test1',
        displayName: 'Alice',
        avatarEmoji: 'A',
        passkeys: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    await service.replaceSessions([
      {
        tokenHash: 'token-hash-1',
        userId: 'user-1',
        createdAt: 1,
        lastUsedAt: 2,
        expiresAt: 999999,
      },
    ]);

    await rm(path.join(tempDir, 'auth', 'auth.state.json'));

    expect(await service.getUsers()).toEqual([
      {
        id: 'user-1',
        accountId: 'test1',
        displayName: 'Alice',
        avatarEmoji: 'A',
        passkeys: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    expect(await service.getSessions()).toEqual([
      {
        tokenHash: 'token-hash-1',
        userId: 'user-1',
        createdAt: 1,
        lastUsedAt: 2,
        expiresAt: 999999,
      },
    ]);
  });

  it('rebuilds auth state from the auth log when the state snapshot is corrupt', async () => {
    await service.replaceUsers([
      {
        id: 'user-1',
        accountId: 'test1',
        displayName: 'Alice',
        avatarEmoji: 'A',
        passkeys: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    await writeFile(path.join(tempDir, 'auth', 'auth.state.json'), '{broken', 'utf-8');

    const users = await service.getUsers();
    expect(users.map((user) => user.id)).toEqual(['user-1']);
  });

  it('removes legacy auth JSON after confirming JSONL auth storage is usable', async () => {
    await writeFile(
      path.join(tempDir, 'auth', 'users.json'),
      JSON.stringify([
        {
          id: 'legacy-user',
          accountId: 'legacy',
          displayName: 'Legacy',
          avatarEmoji: 'L',
          passkeys: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      'utf-8',
    );
    await writeFile(
      path.join(tempDir, 'auth', 'sessions.json'),
      JSON.stringify([]),
      'utf-8',
    );
    await writeFile(
      path.join(tempDir, 'auth', 'auth.jsonl'),
      `${JSON.stringify({
        recordId: 'r1',
        seq: 1,
        timestamp: 1,
        type: 'AUTH_MIGRATED',
        userCount: 1,
        sessionCount: 0,
      })}\n${JSON.stringify({
        recordId: 'r2',
        seq: 2,
        timestamp: 1,
        type: 'USER_UPSERTED',
        user: {
          id: 'legacy-user',
          accountId: 'legacy',
          displayName: 'Legacy',
          avatarEmoji: 'L',
          passkeys: [],
          createdAt: 1,
          updatedAt: 1,
        },
      })}\n`,
      'utf-8',
    );

    const users = await service.getUsers();
    expect(users.map((user) => user.id)).toEqual(['legacy-user']);
    await expect(readFile(path.join(tempDir, 'auth', 'users.json'), 'utf-8')).rejects.toThrow();
    await expect(readFile(path.join(tempDir, 'auth', 'sessions.json'), 'utf-8')).rejects.toThrow();
  });

  it('rebuilds a corrupt auth state snapshot during legacy cleanup before removing legacy files', async () => {
    await writeFile(
      path.join(tempDir, 'auth', 'users.json'),
      JSON.stringify([]),
      'utf-8',
    );
    await writeFile(
      path.join(tempDir, 'auth', 'sessions.json'),
      JSON.stringify([]),
      'utf-8',
    );
    await writeFile(
      path.join(tempDir, 'auth', 'auth.jsonl'),
      `${JSON.stringify({
        recordId: 'r1',
        seq: 1,
        timestamp: 1,
        type: 'AUTH_MIGRATED',
        userCount: 0,
        sessionCount: 0,
      })}\n`,
      'utf-8',
    );
    await writeFile(path.join(tempDir, 'auth', 'auth.state.json'), '{broken', 'utf-8');

    expect(await service.getUsers()).toEqual([]);
    await expect(readFile(path.join(tempDir, 'auth', 'users.json'), 'utf-8')).rejects.toThrow();
    await expect(readFile(path.join(tempDir, 'auth', 'sessions.json'), 'utf-8')).rejects.toThrow();
  });

  it('does not append duplicate user events when record field order differs', async () => {
    const firstUser = {
      id: 'user-1',
      accountId: 'test1',
      displayName: 'Alice',
      avatarEmoji: 'A',
      passwordHash: 'hash',
      passkeys: [
        {
          credentialId: 'cred-1',
          publicKey: 'pk',
          counter: 1,
          transports: ['usb', 'nfc'],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
    const reorderedUser = {
      accountId: 'test1',
      id: 'user-1',
      avatarEmoji: 'A',
      displayName: 'Alice',
      passkeys: [
        {
          publicKey: 'pk',
          credentialId: 'cred-1',
          transports: ['usb', 'nfc'],
          counter: 1,
          updatedAt: 2,
          createdAt: 1,
        },
      ],
      updatedAt: 2,
      passwordHash: 'hash',
      createdAt: 1,
    };

    await service.replaceUsers([firstUser]);
    await service.replaceUsers([reorderedUser as typeof firstUser]);

    const logRaw = await readFile(path.join(tempDir, 'auth', 'auth.jsonl'), 'utf-8');
    expect(logRaw.trim().split('\n')).toHaveLength(1);
  });

  it('does not append duplicate session events when record field order differs', async () => {
    const firstSession = {
      tokenHash: 'token-hash-1',
      userId: 'user-1',
      expiresAt: 10,
      lastUsedAt: 5,
      createdAt: 1,
    };
    const reorderedSession = {
      userId: 'user-1',
      tokenHash: 'token-hash-1',
      createdAt: 1,
      lastUsedAt: 5,
      expiresAt: 10,
    };

    await service.replaceSessions([firstSession]);
    await service.replaceSessions([reorderedSession]);

    const logRaw = await readFile(path.join(tempDir, 'auth', 'auth.jsonl'), 'utf-8');
    expect(logRaw.trim().split('\n')).toHaveLength(1);
  });
});
