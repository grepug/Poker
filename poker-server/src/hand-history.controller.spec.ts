import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { HandHistoryController } from './hand-history.controller';
import { AuthService } from './auth/auth.service';

describe('HandHistoryController', () => {
  let controller: HandHistoryController;
  let authService: {
    getCurrentSession: jest.Mock;
  };
  let storageService: {
    getRoom: jest.Mock;
    getAllRooms: jest.Mock;
  };
  let handHistoryStorageService: {
    getCompletedHandHistory: jest.Mock;
    getCompletedGameHistory: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      getCurrentSession: jest.fn(),
    };
    storageService = {
      getRoom: jest.fn(),
      getAllRooms: jest.fn(),
    };
    handHistoryStorageService = {
      getCompletedHandHistory: jest.fn(),
      getCompletedGameHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HandHistoryController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: 'IStorageService',
          useValue: storageService,
        },
        {
          provide: 'IHandHistoryStorageService',
          useValue: handHistoryStorageService,
        },
      ],
    }).compile();

    controller = module.get<HandHistoryController>(HandHistoryController);
  });

  it('lists rejoinable rooms for the authenticated user based on current room state', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-bob' },
    });
    storageService.getAllRooms.mockResolvedValue([
      {
        id: 'ROOM1',
        hostId: 'p-alice',
        config: {
          startingChips: 1000,
          smallBlind: 5,
          bigBlind: 10,
          maxPlayers: 4,
          reconnectGracePeriod: 30000,
          allowPlayerStreetReveal: true,
          useShortDeckRules: false,
        },
        players: [
          {
            id: 'p-alice',
            userId: 'user-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            handsPlayedCount: 0,
            handsWonCount: 0,
            vpipHandsCount: 0,
            status: 'connected',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
          {
            id: 'p-bob',
            userId: 'user-bob',
            socketId: '',
            name: 'Bob',
            position: 99,
            chips: 850,
            totalBuyIn: 1000,
            handsPlayedCount: 2,
            handsWonCount: 1,
            vpipHandsCount: 1,
            status: 'left',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
        ],
        gameState: 'IN_PROGRESS',
        currentHand: {
          handNumber: 4,
          dealerPosition: 0,
          smallBlindPosition: 1,
          bigBlindPosition: 0,
          currentPlayerTurn: null,
          pot: 40,
          communityCards: [],
          bettingRound: 'RIVER',
          currentBet: 20,
          lastRaiseSize: 10,
          activePlayers: ['p-alice'],
          roundActions: {},
          sidePots: [],
          potContributions: {},
          vpipPlayerIds: [],
          startedAt: Date.now(),
          lastResult: {
            winners: [],
            playerHands: [],
            pot: 40,
            timestamp: Date.now(),
          },
        },
        createdAt: Date.now(),
        lastActivityAt: 123456,
      },
      {
        id: 'ROOM2',
        hostId: 'p-charlie',
        config: {
          startingChips: 1000,
          smallBlind: 5,
          bigBlind: 10,
          maxPlayers: 4,
          reconnectGracePeriod: 30000,
          allowPlayerStreetReveal: true,
          useShortDeckRules: true,
        },
        players: [
          {
            id: 'p-charlie',
            userId: 'user-charlie',
            socketId: 's-charlie',
            name: 'Charlie',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            handsPlayedCount: 0,
            handsWonCount: 0,
            vpipHandsCount: 0,
            status: 'connected',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
        ],
        gameState: 'WAITING',
        currentHand: null,
        createdAt: Date.now(),
        lastActivityAt: 654321,
      },
    ]);

    const result = await controller.listRejoinableRooms(
      { headers: { cookie: 'poker_session=token-bob' } } as any,
      undefined,
    );

    expect(result).toEqual([
      expect.objectContaining({
        roomId: 'ROOM1',
        seatedPlayerCount: 1,
        maxPlayers: 4,
        useShortDeckRules: false,
        hostName: 'Alice',
      }),
    ]);
  });

  it('rejects rejoinable room listing without an authenticated session', async () => {
    authService.getCurrentSession.mockResolvedValue(null);

    await expect(
      controller.listRejoinableRooms({ headers: {} } as any, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('excludes rooms left by other users and seats that can no longer be reclaimed', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-bob' },
    });
    storageService.getAllRooms.mockResolvedValue([
      {
        id: 'ROOM-OTHER-USER',
        hostId: 'p-alice',
        config: {
          startingChips: 1000,
          smallBlind: 5,
          bigBlind: 10,
          maxPlayers: 4,
          reconnectGracePeriod: 30000,
          allowPlayerStreetReveal: true,
          useShortDeckRules: false,
        },
        players: [
          {
            id: 'p-alice',
            userId: 'user-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            handsPlayedCount: 0,
            handsWonCount: 0,
            vpipHandsCount: 0,
            status: 'connected',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
          {
            id: 'p-eve',
            userId: 'user-eve',
            socketId: '',
            name: 'Eve',
            position: 1,
            chips: 850,
            totalBuyIn: 1000,
            handsPlayedCount: 2,
            handsWonCount: 1,
            vpipHandsCount: 1,
            status: 'left',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
        ],
        gameState: 'IN_PROGRESS',
        currentHand: null,
        createdAt: Date.now(),
        lastActivityAt: 101,
      },
      {
        id: 'ROOM-FULL',
        hostId: 'p-alice',
        config: {
          startingChips: 1000,
          smallBlind: 5,
          bigBlind: 10,
          maxPlayers: 2,
          reconnectGracePeriod: 30000,
          allowPlayerStreetReveal: true,
          useShortDeckRules: false,
        },
        players: [
          {
            id: 'p-alice',
            userId: 'user-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            handsPlayedCount: 0,
            handsWonCount: 0,
            vpipHandsCount: 0,
            status: 'connected',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
          {
            id: 'p-charlie',
            userId: 'user-charlie',
            socketId: 's-charlie',
            name: 'Charlie',
            position: 1,
            chips: 900,
            totalBuyIn: 1000,
            handsPlayedCount: 0,
            handsWonCount: 0,
            vpipHandsCount: 0,
            status: 'connected',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
          {
            id: 'p-bob',
            userId: 'user-bob',
            socketId: '',
            name: 'Bob',
            position: 1,
            chips: 850,
            totalBuyIn: 1000,
            handsPlayedCount: 2,
            handsWonCount: 1,
            vpipHandsCount: 1,
            status: 'left',
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
        ],
        gameState: 'IN_PROGRESS',
        currentHand: null,
        createdAt: Date.now(),
        lastActivityAt: 202,
      },
    ]);

    const result = await controller.listRejoinableRooms(
      { headers: { cookie: 'poker_session=token-bob' } } as any,
      undefined,
    );

    expect(result).toEqual([]);
  });
});
