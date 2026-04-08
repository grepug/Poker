import { EventsGateway } from '../../src/events/events.gateway';

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('EventsGateway reveal next street idempotency', () => {
  let gateway: EventsGateway;
  let roomState: any;
  let storageService: any;
  let handService: any;
  let roomEmitter: { emit: jest.Mock };

  beforeEach(() => {
    roomState = {
      id: 'ROOM1',
      hostId: 'p-alice',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 9,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      gameState: 'IN_PROGRESS',
      readyPhase: null,
      readyPlayerIds: [],
      players: [
        {
          id: 'p-alice',
          socketId: 'socket-alice',
          name: 'Alice',
          chips: 980,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'active',
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'K' },
          ],
          currentBet: 0,
          lastAction: 'check',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p-bob',
          socketId: 'socket-bob',
          name: 'Bob',
          chips: 980,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 1,
          status: 'active',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          currentBet: 0,
          lastAction: 'check',
          lastConnectedAt: Date.now(),
        },
      ],
      currentHand: {
        handNumber: 1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        bettingRound: 'PRE_FLOP',
        communityCards: [],
        pot: 20,
        currentBet: 0,
        currentPlayerTurn: null,
        activePlayers: ['p-alice', 'p-bob'],
        roundActions: {},
        sidePots: [],
        potContributions: {},
        pendingStreetRevealRound: 'FLOP',
        nextStreetReadyPlayerIds: [],
        nextStreetRequiredPlayerIds: ['p-alice', 'p-bob'],
        revealedPlayerIds: [],
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    storageService = {
      getRoom: jest.fn(async (roomId: string) => {
        if (roomId !== 'ROOM1') {
          return null;
        }
        return deepClone(roomState);
      }),
      persistRoom: jest.fn(async (room: any) => {
        roomState = deepClone(room);
      }),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(),
      roomExists: jest.fn(),
    };

    handService = {
      advanceBettingRound: jest.fn(async (room: any) => {
        room.currentHand.bettingRound = 'FLOP';
        room.currentHand.currentPlayerTurn = 'p-bob';
        room.lastActivityAt = Date.now();
        await storageService.persistRoom(room);
        return 'FLOP';
      }),
      determineWinner: jest.fn(),
      startNewHand: jest.fn(),
      getNextPlayer: jest.fn(),
    };

    roomEmitter = { emit: jest.fn() };

    gateway = new EventsGateway(
      {} as any,
      handService,
      {
        calculateMinRaise: jest.fn().mockReturnValue(10),
      } as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      {
        isConfigured: jest.fn().mockReturnValue(false),
        getConfigurationError: jest
          .fn()
          .mockReturnValue('robot ai unavailable'),
        decideAction: jest.fn(),
      } as any,
      { scheduleArchiveReview: jest.fn().mockResolvedValue(undefined) } as any,
      { getUserByToken: jest.fn() } as any,
      storageService,
      storageService as any,
      {
        getMessagePage: jest.fn().mockResolvedValue({
          messages: [],
          hasMore: false,
          nextBeforeSeq: null,
        }),
        appendMessage: jest.fn(),
        hasChatData: jest.fn(),
        deleteRoomChat: jest.fn(),
        listRoomsWithChatData: jest.fn(),
        pruneRoomMessages: jest.fn(),
      } as any,
      {
        saveVoiceClip: jest.fn(),
        deleteRoomMedia: jest.fn(),
        pruneOrphanMedia: jest.fn(),
      } as any,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      sockets: { sockets: new Map() },
    } as any;

    (gateway as any).socketToPlayer.set('socket-alice', {
      roomId: 'ROOM1',
      playerId: 'p-alice',
    });
    (gateway as any).socketToPlayer.set('socket-bob', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });
  });

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  it('silently ignores a duplicated reveal request triggered by race', async () => {
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;
    const bobClient = { id: 'socket-bob', emit: jest.fn() } as any;

    const [first, duplicate] = await Promise.all([
      gateway.handleRevealNextStreet(aliceClient, {} as any),
      gateway.handleRevealNextStreet(bobClient, {} as any),
    ]);

    expect(first).toEqual(expect.objectContaining({ success: true }));
    expect(duplicate).toEqual(expect.objectContaining({ success: true }));
    expect(handService.advanceBettingRound).toHaveBeenCalledTimes(1);
    expect(aliceClient.emit).not.toHaveBeenCalledWith(
      'ERROR',
      expect.anything(),
    );
    expect(bobClient.emit).not.toHaveBeenCalledWith('ERROR', expect.anything());
  });
});
