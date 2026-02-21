import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as webauthnServer from '@simplewebauthn/server';
import {
  AuthSessionRecord,
  AuthUserRecord,
  IAuthStorageService,
} from '../../src/common/interfaces/auth-storage.interface';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { realtimeEventBus } from '../../src/common/realtime-events';
import { AuthService } from '../../src/auth/auth.service';

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest.fn(async () => ({
    challenge: 'mock-auth-challenge',
  })),
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'mock-register-challenge',
  })),
  verifyAuthenticationResponse: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('AuthService', () => {
  let users: AuthUserRecord[];
  let sessions: AuthSessionRecord[];
  let authStorageService: jest.Mocked<IAuthStorageService>;
  let storageService: jest.Mocked<IStorageService>;
  let service: AuthService;

  beforeEach(() => {
    users = [];
    sessions = [];

    authStorageService = {
      getUsers: jest.fn(async () => clone(users)),
      saveUsers: jest.fn(async (nextUsers) => {
        users = clone(nextUsers);
      }),
      getSessions: jest.fn(async () => clone(sessions)),
      saveSessions: jest.fn(async (nextSessions) => {
        sessions = clone(nextSessions);
      }),
    };

    storageService = {
      getRoom: jest.fn(),
      saveRoom: jest.fn(),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(async () => []),
      roomExists: jest.fn(),
    };

    service = new AuthService(authStorageService, storageService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds three password test users in non-production mode', async () => {
    await service.onModuleInit();

    const accountIds = users.map((entry) => entry.accountId).sort();
    expect(accountIds).toEqual(['test1', 'test2', 'test3']);
    expect(users.every((entry) => Boolean(entry.passwordHash))).toBe(true);
  });

  it('logs in seeded test account with password', async () => {
    await service.onModuleInit();

    const session = await service.loginWithPassword({
      accountId: 'test1',
      password: 'test1234',
    });

    expect(session.user.accountId).toBe('test1');
    expect(session.sessionToken).toEqual(expect.any(String));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe(users.find((entry) => entry.accountId === 'test1')?.id);
  });

  it('starts passkey registration with flow id and options', async () => {
    const result = await service.startPasskeyRegistration({
      displayName: 'alice',
      avatarEmoji: '🦊',
      rateLimitKey: '127.0.0.1',
    });

    expect(result.flowId).toEqual(expect.any(String));
    expect(result.options).toEqual(
      expect.objectContaining({
        challenge: expect.any(String),
      }),
    );
  });

  it('starts passkey login with flow id and options', async () => {
    const result = await service.startPasskeyLogin({
      rateLimitKey: '127.0.0.1',
    });

    expect(result.flowId).toEqual(expect.any(String));
    expect(result.options).toEqual(
      expect.objectContaining({
        challenge: expect.any(String),
      }),
    );
  });

  it('rejects finish passkey registration for invalid flow', async () => {
    await expect(
      service.finishPasskeyRegistration({
        flowId: 'missing-flow',
        response: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects finish passkey login for invalid flow', async () => {
    await expect(
      service.finishPasskeyLogin({
        flowId: 'missing-flow',
        response: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates passkey counter via queued user mutation without downgrading', async () => {
    users = [
      {
        id: 'user-1',
        accountId: 'pk_test',
        displayName: 'alice',
        avatarEmoji: '🦊',
        passkeys: [
          {
            credentialId: 'cred-1',
            publicKey: Buffer.from('public-key').toString('base64url'),
            counter: 10,
            transports: ['internal'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    (
      webauthnServer.verifyAuthenticationResponse as jest.Mock
    ).mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 7,
        },
      } as any);

    const { flowId } = await service.startPasskeyLogin({
      rateLimitKey: '127.0.0.1',
    });

    await service.finishPasskeyLogin({
      flowId,
      response: { id: 'cred-1' },
    });

    expect(users[0].passkeys[0].counter).toBe(10);
    expect(authStorageService.saveUsers).toHaveBeenCalledTimes(1);
  });

  it('returns current session and invalidates it on logout', async () => {
    await service.onModuleInit();
    const login = await service.loginWithPassword({
      accountId: 'test2',
      password: 'test1234',
    });

    const current = await service.getCurrentSession(login.sessionToken);
    expect(current?.user.accountId).toBe('test2');

    await service.logout(login.sessionToken);
    const afterLogout = await service.getCurrentSession(login.sessionToken);
    expect(afterLogout).toBeNull();
  });

  it('serializes concurrent session mutations', async () => {
    let concurrentReads = 0;
    let maxConcurrentReads = 0;
    authStorageService.getSessions.mockImplementation(async () => {
      concurrentReads += 1;
      maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const snapshot = clone(sessions);
      concurrentReads -= 1;
      return snapshot;
    });

    await Promise.all([
      (service as any).createSessionForUser('user-1'),
      (service as any).createSessionForUser('user-1'),
    ]);

    expect(maxConcurrentReads).toBe(1);
    expect(sessions).toHaveLength(2);
  });

  it('rejects updateProfileByToken when token is invalid', async () => {
    await expect(
      service.updateProfileByToken({
        token: 'invalid-token',
        displayName: 'alice',
        avatarEmoji: '🦊',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates profile and propagates to active room players by userId', async () => {
    const userId = 'user-1';
    users = [
      {
        id: userId,
        accountId: 'test1',
        displayName: 'test1',
        avatarEmoji: '🧪',
        passwordHash: 'scrypt$abc$123',
        passkeys: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const room = {
      id: 'ROOM1',
      hostId: 'player-1',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [
        {
          id: 'player-1',
          userId,
          socketId: 'socket-1',
          name: 'test1',
          emoji: '🧪',
          chips: 0,
          totalBuyIn: 0,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'waiting',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
        },
      ],
      gameState: 'WAITING',
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    storageService.getAllRooms.mockResolvedValue([clone(room)] as any);

    const updated = await service.updateProfileByUserId({
      userId,
      displayName: 'new-name',
      avatarEmoji: '😎',
    });

    expect(updated.displayName).toBe('new-name');
    expect(updated.avatarEmoji).toBe('😎');
    expect(storageService.saveRoom).toHaveBeenCalledTimes(1);

    const savedRoom = storageService.saveRoom.mock.calls[0][0] as any;
    expect(savedRoom.players[0].name).toBe('new-name');
    expect(savedRoom.players[0].emoji).toBe('😎');
  });

  it('does not emit profile update events when room persistence fails', async () => {
    const userId = 'user-1';
    users = [
      {
        id: userId,
        accountId: 'test1',
        displayName: 'test1',
        avatarEmoji: '🧪',
        passwordHash: 'scrypt$abc$123',
        passkeys: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const roomBase = {
      hostId: 'player-1',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [
        {
          userId,
          socketId: 'socket-1',
          name: 'test1',
          emoji: '🧪',
          chips: 0,
          totalBuyIn: 0,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'waiting',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
        },
      ],
      gameState: 'WAITING' as const,
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const firstRoom = {
      ...roomBase,
      id: 'ROOM1',
      players: [{ ...roomBase.players[0], id: 'player-1' }],
    };
    const secondRoom = {
      ...roomBase,
      id: 'ROOM2',
      players: [{ ...roomBase.players[0], id: 'player-2' }],
    };

    storageService.getAllRooms.mockResolvedValue(
      [clone(firstRoom), clone(secondRoom)] as any,
    );
    storageService.saveRoom
      .mockResolvedValueOnce(undefined as any)
      .mockRejectedValueOnce(new Error('failed to persist room'));

    const emitSpy = jest.spyOn(realtimeEventBus, 'emitEvent');

    await expect(
      service.updateProfileByUserId({
        userId,
        displayName: 'new-name',
        avatarEmoji: '😎',
      }),
    ).rejects.toThrow('failed to persist room');
    expect(storageService.saveRoom).toHaveBeenCalledTimes(2);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('rejects profile update when display name is already taken', async () => {
    users = [
      {
        id: 'user-1',
        accountId: 'test1',
        displayName: 'alice',
        avatarEmoji: '🦊',
        passwordHash: 'scrypt$abc$123',
        passkeys: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'user-2',
        accountId: 'test2',
        displayName: 'bob',
        avatarEmoji: '🐻',
        passwordHash: 'scrypt$abc$123',
        passkeys: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    await expect(
      service.updateProfileByUserId({
        userId: 'user-1',
        displayName: 'bob',
        avatarEmoji: '🦊',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
