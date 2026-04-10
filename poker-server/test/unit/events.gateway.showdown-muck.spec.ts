import { EventsGateway } from '../../src/events/events.gateway';

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('EventsGateway showdown reveal/muck flow', () => {
  let gateway: EventsGateway;
  let gameService: any;
  let roomState: any;
  let storageService: any;
  let handService: any;
  let bettingService: any;
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
          chips: 900,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'connected',
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'K' },
          ],
          currentBet: 0,
          lastAction: 'call',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p-bob',
          socketId: 'socket-bob',
          name: 'Bob',
          chips: 900,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 1,
          status: 'connected',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          currentBet: 0,
          lastAction: 'call',
          lastConnectedAt: Date.now(),
        },
      ],
      currentHand: {
        handNumber: 7,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        bettingRound: 'SHOWDOWN',
        communityCards: [
          { suit: 'hearts', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'clubs', rank: '9' },
          { suit: 'spades', rank: 'T' },
          { suit: 'hearts', rank: 'J' },
        ],
        pot: 200,
        currentBet: 0,
        currentPlayerTurn: null,
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
        showdownLastAggressorPlayerId: 'p-alice',
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    gameService = {
      markPlayerDisconnected: jest.fn(async () => deepClone(roomState)),
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
      determineWinner: jest.fn(async () => ({
        winners: [
          {
            playerId: 'p-bob',
            playerName: 'Bob',
            hand: {
              rank: 'pair',
              cards: [],
              kickers: [],
              description: 'Pair',
            },
            amountWon: 200,
          },
        ],
        playerHands: [
          {
            playerId: 'p-bob',
            playerName: 'Bob',
            cards: [
              { suit: 'spades', rank: 'Q' },
              { suit: 'diamonds', rank: 'J' },
            ],
            hand: {
              rank: 'pair',
              cards: [],
              kickers: [],
              description: 'Pair',
            },
            resultStatus: 'shown',
            cardsVisibility: 'shown',
            seatPosition: 1,
          },
        ],
        totalPot: 200,
        payouts: [
          {
            segmentIndex: 0,
            potType: 'MAIN',
            amount: 200,
            eligiblePlayerIds: ['p-bob'],
            winnerShares: [
              {
                playerId: 'p-bob',
                amountWon: 200,
              },
            ],
            uncontested: true,
          },
        ],
        netByPlayerId: {
          'p-alice': -100,
          'p-bob': 100,
        },
      })),
      startNewHand: jest.fn(),
      getNextPlayer: jest.fn(),
    };

    roomEmitter = { emit: jest.fn() };

    bettingService = {
      calculateMinRaise: jest.fn().mockReturnValue(10),
    };

    gateway = new EventsGateway(
      gameService,
      handService,
      bettingService as any,
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

  it('redacts hidden cards from HAND_COMPLETE while keeping the stored result intact', async () => {
    handService.determineWinner.mockResolvedValueOnce({
      winners: [
        {
          playerId: 'p-bob',
          playerName: 'Bob',
          hand: {
            rank: 'pair',
            cards: [],
            kickers: [],
            description: 'Pair',
          },
          amountWon: 200,
        },
      ],
      playerHands: [
        {
          playerId: 'p-alice',
          playerName: 'Alice',
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'K' },
          ],
          hand: null,
          resultStatus: 'hidden_contender',
          cardsVisibility: 'hidden',
          seatPosition: 0,
        },
        {
          playerId: 'p-bob',
          playerName: 'Bob',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          hand: {
            rank: 'pair',
            cards: [],
            kickers: [],
            description: 'Pair',
          },
          resultStatus: 'shown',
          cardsVisibility: 'shown',
          seatPosition: 1,
        },
      ],
      totalPot: 200,
      payouts: [
        {
          segmentIndex: 0,
          potType: 'MAIN',
          amount: 200,
          eligiblePlayerIds: ['p-alice', 'p-bob'],
          winnerShares: [
            {
              playerId: 'p-bob',
              amountWon: 200,
            },
          ],
          uncontested: false,
        },
      ],
      netByPlayerId: {
        'p-alice': -100,
        'p-bob': 100,
      },
    });

    await (gateway as any).completeAndBroadcastHand(roomState);

    const handCompletePayload = roomEmitter.emit.mock.calls.find(
      ([eventName]) => eventName === 'HAND_COMPLETE',
    )?.[1];
    expect(handCompletePayload?.result?.playerHands).toEqual([
      expect.objectContaining({
        playerId: 'p-alice',
        cards: [],
        hand: null,
        cardsVisibility: 'hidden',
      }),
      expect.objectContaining({
        playerId: 'p-bob',
        cards: [
          { suit: 'spades', rank: 'Q' },
          { suit: 'diamonds', rank: 'J' },
        ],
        cardsVisibility: 'shown',
      }),
    ]);
    expect(roomState.currentHand.lastResult.playerHands[0].cards).toEqual([
      { suit: 'hearts', rank: 'A' },
      { suit: 'clubs', rank: 'K' },
    ]);
  });

  it('redacts hidden cards from sanitized room snapshots', () => {
    roomState.currentHand.lastResult = {
      winners: [],
      playerHands: [
        {
          playerId: 'p-alice',
          playerName: 'Alice',
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'K' },
          ],
          hand: null,
          resultStatus: 'hidden_contender',
          cardsVisibility: 'hidden',
          seatPosition: 0,
        },
        {
          playerId: 'p-bob',
          playerName: 'Bob',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          hand: {
            rank: 'pair',
            cards: [],
            kickers: [],
            description: 'Pair',
          },
          resultStatus: 'shown',
          cardsVisibility: 'shown',
          seatPosition: 1,
        },
      ],
      totalPot: 200,
      payouts: [],
      netByPlayerId: {
        'p-alice': -100,
        'p-bob': 100,
      },
    };

    const sanitizedRoom = (gateway as any).sanitizeRoom(roomState);

    expect(sanitizedRoom.players[0].cards).toBeUndefined();
    expect(sanitizedRoom.currentHand.lastResult.playerHands).toEqual([
      expect.objectContaining({
        playerId: 'p-alice',
        cards: [],
        hand: null,
        cardsVisibility: 'hidden',
      }),
      expect.objectContaining({
        playerId: 'p-bob',
        cards: [
          { suit: 'spades', rank: 'Q' },
          { suit: 'diamonds', rank: 'J' },
        ],
        cardsVisibility: 'shown',
      }),
    ]);
  });

  it('adds the authoritative minRaise to sanitized active-hand snapshots', () => {
    roomState.currentHand = {
      ...roomState.currentHand,
      bettingRound: 'FLOP',
      currentPlayerTurn: 'p-bob',
      currentBet: 20,
      lastRaiseSize: 20,
    };
    bettingService.calculateMinRaise.mockReturnValue(20);

    const sanitizedRoom = (gateway as any).sanitizeRoom(roomState);

    expect(bettingService.calculateMinRaise).toHaveBeenCalledWith(roomState);
    expect(sanitizedRoom.currentHand.minRaise).toBe(20);
    expect(sanitizedRoom.currentHand.currentBet).toBe(20);
  });

  it('reveals a completed hidden hand from server-only settled cards', async () => {
    roomState.currentHand.lastResult = {
      winners: [],
      playerHands: [
        {
          playerId: 'p-alice',
          playerName: 'Alice',
          cards: [],
          hand: null,
          resultStatus: 'hidden_contender',
          cardsVisibility: 'hidden',
          seatPosition: 0,
        },
      ],
      totalPot: 200,
      payouts: [],
      netByPlayerId: {
        'p-alice': -100,
        'p-bob': 100,
      },
    };
    roomState.currentHand.revealedPlayerIds = [];
    roomState.currentHand.settledPlayerCardsByPlayerId = {
      'p-alice': [
        { suit: 'hearts', rank: 'A' },
        { suit: 'clubs', rank: 'K' },
      ],
    };

    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;
    const response = await gateway.handleShowMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_REVEALED',
      expect.objectContaining({
        playerId: 'p-alice',
        cards: [
          { suit: 'hearts', rank: 'A' },
          { suit: 'clubs', rank: 'K' },
        ],
        showdownOrderIndex: -1,
      }),
    );
  });

  it('keeps showdown pending after only one reveal', async () => {
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;

    const response = await gateway.handleShowMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(roomState.currentHand.revealedPlayerIds).toEqual(['p-alice']);
    expect(roomState.currentHand.showdownDecisionPlayerId).toBe('p-bob');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_REVEALED',
      expect.objectContaining({
        playerId: 'p-alice',
        cards: [
          { suit: 'hearts', rank: 'A' },
          { suit: 'clubs', rank: 'K' },
        ],
        showdownOrderIndex: 0,
      }),
    );
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(false);
  });

  it('rejects reveal when player is not current showdown decision player', async () => {
    const bobClient = { id: 'socket-bob', emit: jest.fn() } as any;

    const response = await gateway.handleShowMyHand(bobClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: false }));
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(bobClient.emit).toHaveBeenCalledWith(
      'ERROR',
      expect.objectContaining({
        message: 'It is not your showdown decision turn',
      }),
    );
  });

  it('queues result reveal after muck and settles after reveal action', async () => {
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;
    const bobClient = { id: 'socket-bob', emit: jest.fn() } as any;

    const response = await gateway.handleMuckMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(roomState.currentHand.activePlayers).toEqual(['p-bob']);
    expect(roomState.currentHand.pendingStreetRevealRound).toBe('SHOWDOWN');
    expect(roomState.currentHand.nextStreetRequiredPlayerIds).toEqual([
      'p-bob',
    ]);
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_MUCKED',
      expect.objectContaining({ playerId: 'p-alice' }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'NEXT_STREET_REVEAL_STATE',
      expect.objectContaining({
        nextRound: 'SHOWDOWN',
        readyPlayerIds: [],
        requiredPlayerIds: ['p-bob'],
      }),
    );
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(false);

    const revealResponse = await gateway.handleRevealNextStreet(
      bobClient,
      {} as any,
    );

    expect(revealResponse).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
    const roomPassedToWinner = handService.determineWinner.mock.calls[0][0];
    expect(roomPassedToWinner.currentHand.activePlayers).toEqual(['p-bob']);
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(true);
  });

  it('auto-reveals forced all-in contender, then waits for reveal-result action', async () => {
    roomState.players = roomState.players.map((player: any) =>
      player.id === 'p-bob' ? { ...player, status: 'all-in' } : player,
    );
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;

    const response = await gateway.handleShowMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(roomState.currentHand.pendingStreetRevealRound).toBe('SHOWDOWN');
    expect(
      roomEmitter.emit.mock.calls.filter(
        ([eventName]) => eventName === 'PLAYER_HAND_REVEALED',
      ),
    ).toEqual(
      expect.arrayContaining([
        [
          'PLAYER_HAND_REVEALED',
          expect.objectContaining({
            playerId: 'p-alice',
            showdownOrderIndex: 0,
          }),
        ],
        [
          'PLAYER_HAND_REVEALED',
          expect.objectContaining({ playerId: 'p-bob', showdownOrderIndex: 1 }),
        ],
      ]),
    );

    const revealResponse = await gateway.handleRevealNextStreet(
      aliceClient,
      {} as any,
    );
    expect(revealResponse).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
  });

  it('auto-mucks disconnected showdown decision player on disconnect timeout', async () => {
    roomState.players = roomState.players.map((player: any) =>
      player.id === 'p-alice' ? { ...player, status: 'disconnected' } : player,
    );
    roomState.currentHand.showdownDecisionOrder = ['p-alice', 'p-bob'];
    roomState.currentHand.showdownDecisionIndex = 0;
    roomState.currentHand.showdownDecisionPlayerId = 'p-alice';

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-alice');

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_MUCKED',
      expect.objectContaining({ playerId: 'p-alice' }),
    );
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(roomState.currentHand.pendingStreetRevealRound).toBe('SHOWDOWN');

    const bobClient = { id: 'socket-bob', emit: jest.fn() } as any;
    const revealResponse = await gateway.handleRevealNextStreet(
      bobClient,
      {} as any,
    );
    expect(revealResponse).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
  });

  it('queues reveal-result step for fold-out even when street reveal config is disabled', async () => {
    roomState.config.allowPlayerStreetReveal = false;
    roomState.currentHand.bettingRound = 'PRE_FLOP';
    roomState.currentHand.currentPlayerTurn = 'p-bob';
    roomState.currentHand.activePlayers = ['p-alice'];
    roomState.players = roomState.players.map((player: any) =>
      player.id === 'p-bob'
        ? { ...player, status: 'folded', lastAction: 'fold' }
        : player,
    );
    handService.isHandComplete.mockReturnValue(true);

    await (gateway as any).handleBettingRoundComplete(roomState);

    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(roomState.currentHand.currentPlayerTurn).toBeNull();
    expect(roomState.currentHand.pendingStreetRevealRound).toBe('SHOWDOWN');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'NEXT_STREET_REVEAL_STATE',
      expect.objectContaining({
        nextRound: 'SHOWDOWN',
      }),
    );
  });

  it('settles fold-out hand after reveal-result action', async () => {
    roomState.config.allowPlayerStreetReveal = false;
    roomState.currentHand.bettingRound = 'PRE_FLOP';
    roomState.currentHand.currentPlayerTurn = null;
    roomState.currentHand.activePlayers = ['p-alice'];
    roomState.currentHand.pendingStreetRevealRound = 'SHOWDOWN';
    roomState.currentHand.nextStreetReadyPlayerIds = [];
    roomState.currentHand.nextStreetRequiredPlayerIds = ['p-alice'];
    roomState.players = roomState.players.map((player: any) =>
      player.id === 'p-bob'
        ? { ...player, status: 'folded', lastAction: 'fold' }
        : player,
    );
    handService.isHandComplete.mockReturnValue(true);

    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;
    const revealResponse = await gateway.handleRevealNextStreet(
      aliceClient,
      {} as any,
    );

    expect(revealResponse).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(true);
  });

  it('settles immediately when only robot seats would be required for reveal-result gating', async () => {
    roomState.config.allowPlayerStreetReveal = false;
    roomState.players = [
      {
        ...roomState.players[0],
        status: 'connected',
        connectionStatus: 'disconnected',
        cards: null,
        currentBet: 0,
        lastAction: null,
      },
      {
        ...roomState.players[1],
        socketId: '',
        isRobot: true,
        status: 'connected',
      },
      {
        id: 'p-robot-1',
        socketId: '',
        name: 'Robot 1',
        isRobot: true,
        chips: 980,
        totalBuyIn: 1000,
        handsPlayedCount: 0,
        handsWonCount: 0,
        vpipHandsCount: 0,
        position: 2,
        status: 'folded',
        cards: [
          { suit: 'clubs', rank: '3' },
          { suit: 'diamonds', rank: 'T' },
        ],
        currentBet: 5,
        lastAction: 'fold',
        lastConnectedAt: Date.now(),
      },
    ];
    roomState.currentHand.bettingRound = 'PRE_FLOP';
    roomState.currentHand.currentPlayerTurn = null;
    roomState.currentHand.activePlayers = ['p-bob'];
    roomState.currentHand.pendingStreetRevealRound = null;
    roomState.currentHand.nextStreetReadyPlayerIds = [];
    roomState.currentHand.nextStreetRequiredPlayerIds = [];
    roomState.currentHand.communityCards = [];
    roomState.currentHand.dealtPlayerIds = ['p-robot-1', 'p-bob'];
    roomState.currentHand.positionLabelsByPlayerId = {
      'p-robot-1': 'BB',
      'p-bob': 'BTN/SB',
    };
    roomState.currentHand.pot = 15;
    roomState.currentHand.currentBet = 10;
    roomState.currentHand.potContributions = {
      'p-robot-1': 5,
      'p-bob': 10,
    };
    handService.isHandComplete.mockReturnValue(true);

    await (gateway as any).handleBettingRoundComplete(roomState);

    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
    expect(roomState.currentHand.pendingStreetRevealRound).toBeNull();
    expect(roomState.currentHand.nextStreetRequiredPlayerIds).toEqual([]);
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'NEXT_STREET_REVEAL_STATE',
      ),
    ).toBe(false);
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(true);
  });

  it('auto-resolves robot showdown actors after a human folds out', async () => {
    roomState.players = [
      {
        ...roomState.players[0],
        name: 'Kai',
        status: 'folded',
        cards: null,
        currentBet: 10,
        lastAction: 'fold',
      },
      {
        ...roomState.players[1],
        id: 'p-robot-2',
        socketId: '',
        name: 'Robot 2',
        isRobot: true,
        position: 1,
        status: 'connected',
        cards: [
          { suit: 'spades', rank: 'Q' },
          { suit: 'diamonds', rank: 'J' },
        ],
        currentBet: 10,
        lastAction: 'check',
      },
      {
        id: 'p-robot-1',
        socketId: '',
        name: 'Robot 1',
        isRobot: true,
        chips: 990,
        totalBuyIn: 1000,
        handsPlayedCount: 0,
        handsWonCount: 0,
        vpipHandsCount: 0,
        position: 2,
        status: 'connected',
        cards: [
          { suit: 'clubs', rank: '7' },
          { suit: 'hearts', rank: '5' },
        ],
        currentBet: 10,
        lastAction: 'check',
        lastConnectedAt: Date.now(),
      },
    ];
    roomState.currentHand.communityCards = [
      { suit: 'clubs', rank: 'T' },
      { suit: 'hearts', rank: 'Q' },
      { suit: 'spades', rank: '7' },
      { suit: 'hearts', rank: '4' },
      { suit: 'spades', rank: 'T' },
    ];
    roomState.currentHand.activePlayers = ['p-robot-1', 'p-robot-2'];
    roomState.currentHand.currentPlayerTurn = null;
    roomState.currentHand.pendingStreetRevealRound = null;
    roomState.currentHand.nextStreetReadyPlayerIds = [];
    roomState.currentHand.nextStreetRequiredPlayerIds = [];
    roomState.currentHand.revealedPlayerIds = [];
    roomState.currentHand.showdownDecisionOrder = [];
    roomState.currentHand.showdownDecisionIndex = undefined;
    roomState.currentHand.showdownDecisionPlayerId = null;
    roomState.currentHand.showdownForcedRevealPlayerIds = [];
    roomState.currentHand.showdownLastAggressorPlayerId = 'p-robot-1';
    handService.determineWinner.mockResolvedValueOnce({
      winners: [
        {
          playerId: 'p-robot-2',
          playerName: 'Robot 2',
          hand: {
            rank: 'two_pair',
            cards: [],
            kickers: [],
            description: 'Two pair',
          },
          amountWon: 30,
        },
      ],
      playerHands: [
        {
          playerId: 'p-robot-1',
          playerName: 'Robot 1',
          cards: [
            { suit: 'clubs', rank: '7' },
            { suit: 'hearts', rank: '5' },
          ],
          hand: {
            rank: 'two_pair',
            cards: [],
            kickers: [],
            description: 'Two pair',
          },
          resultStatus: 'shown',
          cardsVisibility: 'shown',
          seatPosition: 2,
        },
        {
          playerId: 'p-robot-2',
          playerName: 'Robot 2',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          hand: {
            rank: 'full_house',
            cards: [],
            kickers: [],
            description: 'Full house',
          },
          resultStatus: 'shown',
          cardsVisibility: 'shown',
          seatPosition: 1,
        },
      ],
      totalPot: 30,
      payouts: [
        {
          segmentIndex: 0,
          potType: 'MAIN',
          amount: 30,
          eligiblePlayerIds: ['p-robot-1', 'p-robot-2'],
          winnerShares: [{ playerId: 'p-robot-2', amountWon: 30 }],
          uncontested: false,
        },
      ],
      netByPlayerId: {
        'p-alice': -10,
        'p-robot-1': -10,
        'p-robot-2': 20,
      },
    });

    await (gateway as any).initializeShowdownDecisionState(roomState);

    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
    expect(roomState.currentHand.lastResult).toBeTruthy();
    expect(roomState.currentHand.showdownDecisionPlayerId).toBeNull();
    expect(roomState.currentHand.pendingStreetRevealRound).toBeNull();
    expect(roomState.currentHand.revealedPlayerIds).toEqual([
      'p-robot-1',
      'p-robot-2',
    ]);
    expect(
      roomEmitter.emit.mock.calls.filter(
        ([eventName]) => eventName === 'PLAYER_HAND_REVEALED',
      ),
    ).toEqual(
      expect.arrayContaining([
        [
          'PLAYER_HAND_REVEALED',
          expect.objectContaining({
            playerId: 'p-robot-1',
            showdownOrderIndex: 0,
          }),
        ],
        [
          'PLAYER_HAND_REVEALED',
          expect.objectContaining({
            playerId: 'p-robot-2',
            showdownOrderIndex: 1,
          }),
        ],
      ]),
    );
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(true);
  });
});
