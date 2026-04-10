import { EventsGateway } from '../../src/events/events.gateway';

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('EventsGateway run-count decision flow', () => {
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
          chips: 0,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'all-in',
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'K' },
          ],
          currentBet: 0,
          lastAction: 'all-in',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p-bob',
          socketId: 'socket-bob',
          name: 'Bob',
          chips: 0,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 1,
          status: 'all-in',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          currentBet: 0,
          lastAction: 'all-in',
          lastConnectedAt: Date.now(),
        },
      ],
      currentHand: {
        handNumber: 9,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        bettingRound: 'FLOP',
        communityCards: [
          { suit: 'clubs', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'hearts', rank: '9' },
        ],
        pot: 200,
        currentBet: 0,
        currentPlayerTurn: 'p-bob',
        activePlayers: ['p-alice', 'p-bob'],
        roundActions: {},
        sidePots: [],
        potContributions: {
          'p-alice': 100,
          'p-bob': 100,
        },
        pendingStreetRevealRound: null,
        nextStreetReadyPlayerIds: [],
        nextStreetRequiredPlayerIds: [],
        revealedPlayerIds: [],
        showdownDecisionOrder: [],
        showdownDecisionIndex: undefined,
        showdownDecisionPlayerId: null,
        showdownForcedRevealPlayerIds: [],
        showdownLastAggressorPlayerId: null,
        runCountDecision: null,
        runCount: 1,
        runoutBoards: [],
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
      advanceBettingRound: jest.fn(),
      isHandComplete: jest.fn(() => false),
      determineWinner: jest.fn(),
      resolveRunCount: jest.fn(async (room: any, runCount: 1 | 2) => {
        room.currentHand.runCount = runCount;
        room.currentHand.runCountDecision = null;
        room.currentHand.bettingRound = 'SHOWDOWN';
        room.currentHand.currentPlayerTurn = null;
        room.currentHand.communityCards = [
          { suit: 'clubs', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'hearts', rank: '9' },
          { suit: 'spades', rank: '10' },
          { suit: 'clubs', rank: 'J' },
        ];
        room.currentHand.runoutBoards =
          runCount === 2
            ? [
                [
                  { suit: 'clubs', rank: '2' },
                  { suit: 'diamonds', rank: '7' },
                  { suit: 'hearts', rank: '9' },
                  { suit: 'spades', rank: '10' },
                  { suit: 'clubs', rank: 'J' },
                ],
                [
                  { suit: 'clubs', rank: '2' },
                  { suit: 'diamonds', rank: '7' },
                  { suit: 'hearts', rank: '9' },
                  { suit: 'hearts', rank: 'Q' },
                  { suit: 'spades', rank: 'K' },
                ],
              ]
            : [
                [
                  { suit: 'clubs', rank: '2' },
                  { suit: 'diamonds', rank: '7' },
                  { suit: 'hearts', rank: '9' },
                  { suit: 'spades', rank: '10' },
                  { suit: 'clubs', rank: 'J' },
                ],
              ];
        await storageService.persistRoom(room);
        return 'SHOWDOWN';
      }),
      startNewHand: jest.fn(),
      getNextPlayer: jest.fn(),
    };

    roomEmitter = { emit: jest.fn() };

    gateway = new EventsGateway(
      {
        markPlayerDisconnected: jest.fn(async () => deepClone(roomState)),
        transferHostOnDisconnectTimeout: jest.fn(async () => deepClone(roomState)),
      } as any,
      handService,
      {
        calculateMinRaise: jest.fn().mockReturnValue(10),
        isBettingRoundComplete: jest.fn(() => true),
      } as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      {
        isConfigured: jest.fn().mockReturnValue(false),
        getConfigurationError: jest.fn().mockReturnValue(null),
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
    jest.useRealTimers();
    gateway.onModuleDestroy();
  });

  it('starts a run-count decision instead of auto-dealing the remaining board', async () => {
    await (gateway as any).handleBettingRoundComplete(roomState);

    expect(handService.advanceBettingRound).not.toHaveBeenCalled();
    expect(roomState.currentHand.currentPlayerTurn).toBeNull();
    expect(roomState.currentHand.runCountDecision).toEqual(
      expect.objectContaining({
        eligiblePlayerIds: ['p-alice', 'p-bob'],
        twiceAgreedPlayerIds: [],
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'RUN_COUNT_DECISION_STATE',
      expect.objectContaining({
        handNumber: 9,
        eligiblePlayerIds: ['p-alice', 'p-bob'],
        twiceAgreedPlayerIds: [],
      }),
    );
  });

  it('only resolves run twice after every eligible player agrees', async () => {
    roomState.currentHand.runCountDecision = {
      eligiblePlayerIds: ['p-alice', 'p-bob'],
      twiceAgreedPlayerIds: [],
      expiresAt: Date.now() + 15000,
    };
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;
    const bobClient = { id: 'socket-bob', emit: jest.fn() } as any;

    const firstResponse = await gateway.handleSetRunCount(aliceClient, {
      runCount: 2,
    });

    expect(firstResponse).toEqual(expect.objectContaining({ success: true }));
    expect(handService.resolveRunCount).not.toHaveBeenCalled();
    expect(roomState.currentHand.runCountDecision.twiceAgreedPlayerIds).toEqual([
      'p-alice',
    ]);

    const secondResponse = await gateway.handleSetRunCount(bobClient, {
      runCount: 2,
    });

    expect(secondResponse).toEqual(expect.objectContaining({ success: true }));
    expect(handService.resolveRunCount).toHaveBeenCalledTimes(1);
    expect(handService.resolveRunCount).toHaveBeenCalledWith(
      expect.any(Object),
      2,
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'COMMUNITY_CARDS_DEALT',
      expect.objectContaining({
        round: 'SHOWDOWN',
        runCount: 2,
        runoutBoards: expect.arrayContaining([
          expect.any(Array),
          expect.any(Array),
        ]),
      }),
    );
  });

  it('falls back to run once when a late run-twice vote arrives after expiry', async () => {
    roomState.currentHand.runCountDecision = {
      eligiblePlayerIds: ['p-alice', 'p-bob'],
      twiceAgreedPlayerIds: [],
      expiresAt: Date.now() - 1,
    };
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;

    const response = await gateway.handleSetRunCount(aliceClient, {
      runCount: 2,
    });

    expect(response).toEqual(
      expect.objectContaining({ success: true, duplicate: true }),
    );
    expect(handService.resolveRunCount).toHaveBeenCalledTimes(1);
    expect(handService.resolveRunCount).toHaveBeenCalledWith(
      expect.any(Object),
      1,
    );
    expect(roomState.currentHand.runCount).toBe(1);
    expect(roomState.currentHand.runCountDecision).toBeNull();
  });

  it('uses the remaining decision time when rescheduling an existing run-count prompt', async () => {
    jest.useFakeTimers();

    roomState.currentHand.runCountDecision = {
      eligiblePlayerIds: ['p-alice', 'p-bob'],
      twiceAgreedPlayerIds: [],
      expiresAt: Date.now() + 50,
    };

    (gateway as any).scheduleRunCountDecisionTimeout(roomState);

    await jest.advanceTimersByTimeAsync(49);
    expect(handService.resolveRunCount).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(handService.resolveRunCount).toHaveBeenCalledTimes(1);
    expect(handService.resolveRunCount).toHaveBeenCalledWith(
      expect.any(Object),
      1,
    );
  });

  it('immediately resolves an already expired persisted run-count decision', async () => {
    roomState.currentHand.runCountDecision = {
      eligiblePlayerIds: ['p-alice', 'p-bob'],
      twiceAgreedPlayerIds: [],
      expiresAt: Date.now() - 1,
    };

    const initialized = await (gateway as any).initializeRunCountDecision(
      roomState,
    );

    expect(initialized).toBe(true);
    expect(handService.resolveRunCount).toHaveBeenCalledTimes(1);
    expect(handService.resolveRunCount).toHaveBeenCalledWith(
      expect.any(Object),
      1,
    );
    expect(roomState.currentHand.runCountDecision).toBeNull();
    expect(roomEmitter.emit).not.toHaveBeenCalledWith(
      'RUN_COUNT_DECISION_STATE',
      expect.objectContaining({
        eligiblePlayerIds: ['p-alice', 'p-bob'],
      }),
    );
  });
});
