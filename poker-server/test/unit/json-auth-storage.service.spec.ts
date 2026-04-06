import { mkdtemp, readFile, rm } from 'fs/promises';
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
});
