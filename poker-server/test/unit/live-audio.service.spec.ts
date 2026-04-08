import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { LiveAudioService } from '../../src/live-audio/live-audio.service';

const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
};

type RoomPlayer = {
  id: string;
  socketId: string;
  userId?: string;
  name: string;
  emoji?: string;
  chips: number;
  totalBuyIn: number;
  handsPlayedCount: number;
  handsWonCount: number;
  vpipHandsCount: number;
  position: number;
  status: string;
  connectionStatus?: string;
  cards: null;
  currentBet: number;
  lastAction: null;
  lastConnectedAt: number;
};

type RoomState = {
  id: string;
  hostId: string;
  config: {
    startingChips: number;
    smallBlind: number;
    bigBlind: number;
    maxPlayers: number;
    reconnectGracePeriod: number;
    allowPlayerStreetReveal: boolean;
  };
  players: RoomPlayer[];
  gameState: string;
  currentHand: null;
  createdAt: number;
  lastActivityAt: number;
};

type ServerPlayer = RoomPlayer & {
  userId?: string;
};

const buildRoom = (players: ServerPlayer[]): RoomState => ({
  id: 'ROOM83',
  hostId: players[0]?.id ?? 'player-1',
  config: {
    startingChips: 1000,
    smallBlind: 5,
    bigBlind: 10,
    maxPlayers: 6,
    reconnectGracePeriod: 120000,
    allowPlayerStreetReveal: true,
  },
  players,
  gameState: 'WAITING',
  currentHand: null,
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
});

describe('LiveAudioService', () => {
  const originalEnv = { ...process.env };
  let storageService: {
    getRoom: jest.Mock;
  };

  beforeEach(() => {
    jest.resetModules();
    process.env.LIVE_AUDIO_ENABLED = 'true';
    process.env.LIVEKIT_URL = 'wss://poker-16h0u738.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'APIzcosD9BpNjx3';
    process.env.LIVEKIT_API_SECRET = 'secret-token-value';

    storageService = {
      getRoom: jest.fn(),
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns disabled config when LiveKit env is absent', () => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const service = new LiveAudioService(storageService as any);

    expect(service.getPublicConfig()).toEqual({
      enabled: false,
    });
  });

  it('mints a microphone-only join token for an authenticated room member', async () => {
    storageService.getRoom.mockResolvedValue(
      buildRoom([
        {
          id: 'player-1',
          socketId: 'socket-1',
          userId: 'user-1',
          name: 'Alice',
          emoji: '🦊',
          chips: 1000,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'connected',
          connectionStatus: 'connected',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
        },
      ]),
    );

    const service = new LiveAudioService(storageService as any);
    const result = await service.createJoinToken({
      roomId: 'room83',
      user: {
        id: 'user-1',
        displayName: 'Alice',
        avatarEmoji: '🦊',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        enabled: true,
        serverUrl: 'wss://poker-16h0u738.livekit.cloud',
        roomName: 'poker-room-ROOM83',
        participantIdentity: 'user-1:player-1',
        participantName: 'Alice',
        participantMetadata: JSON.stringify({
          roomId: 'ROOM83',
          playerId: 'player-1',
          userId: 'user-1',
          displayName: 'Alice',
          avatarEmoji: '🦊',
        }),
      }),
    );

    const payload = decodeJwtPayload(result.token);
    expect(payload.sub).toBe('user-1:player-1');
    expect(payload.metadata).toBe(result.participantMetadata);
    expect(payload.video).toEqual(
      expect.objectContaining({
        room: 'poker-room-ROOM83',
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishSources: ['microphone'],
      }),
    );
  });

  it('rejects token issuance when live audio is disabled', async () => {
    process.env.LIVE_AUDIO_ENABLED = 'false';
    const service = new LiveAudioService(storageService as any);

    await expect(
      service.createJoinToken({
        roomId: 'ROOM83',
        user: {
          id: 'user-1',
          displayName: 'Alice',
          avatarEmoji: '🦊',
        },
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects token issuance when the room does not exist', async () => {
    storageService.getRoom.mockResolvedValue(null);
    const service = new LiveAudioService(storageService as any);

    await expect(
      service.createJoinToken({
        roomId: 'ROOM83',
        user: {
          id: 'user-1',
          displayName: 'Alice',
          avatarEmoji: '🦊',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects token issuance for users who are not active room members', async () => {
    storageService.getRoom.mockResolvedValue(
      buildRoom([
        {
          id: 'player-2',
          socketId: 'socket-2',
          userId: 'user-2',
          name: 'Bob',
          emoji: '🐻',
          chips: 1000,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 1,
          status: 'connected',
          connectionStatus: 'connected',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
        },
      ]),
    );
    const service = new LiveAudioService(storageService as any);

    await expect(
      service.createJoinToken({
        roomId: 'ROOM83',
        user: {
          id: 'user-1',
          displayName: 'Alice',
          avatarEmoji: '🦊',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects token issuance when the caller is missing', async () => {
    const service = new LiveAudioService(storageService as any);

    await expect(
      service.createJoinToken({
        roomId: 'ROOM83',
        user: null,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
