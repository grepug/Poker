import { EventsGateway } from '../../src/events/events.gateway';
import { RobotDecisionError } from '../../src/game/robot-agent.service';

describe('EventsGateway robot player controls', () => {
  let gateway: EventsGateway;
  let roomEmitter: { emit: jest.Mock };
  let gameService: any;
  let handService: any;
  let bettingService: any;
  let testDeckService: any;
  let robotAgentService: any;
  let storageService: any;

  const createPlayer = (params: {
    id: string;
    socketId: string;
    name: string;
    status: string;
    position: number;
    isRobot?: boolean;
    robotPersonality?: string;
  }) => ({
    id: params.id,
    socketId: params.socketId,
    name: params.name,
    isRobot: params.isRobot ?? false,
    robotPersonality: params.robotPersonality,
    chips: 1000,
    totalBuyIn: 1000,
    handsPlayedCount: 0,
    handsWonCount: 0,
    vpipHandsCount: 0,
    position: params.position,
    status: params.status,
    cards: null,
    currentBet: 0,
    lastAction: null,
    lastConnectedAt: Date.now(),
  });

  const createClient = (socketId: string) =>
    ({
      id: socketId,
      emit: jest.fn(),
      handshake: { headers: {} },
    }) as any;

  beforeEach(() => {
    roomEmitter = {
      emit: jest.fn(),
    };

    storageService = {
      getRoom: jest.fn(),
      persistRoom: jest.fn().mockResolvedValue(undefined),
    };

    gameService = {
      addRobotToRoom: jest.fn(),
      removeRobotFromRoom: jest.fn(),
      transferHostOnDisconnectTimeout: jest.fn(),
    };

    handService = {
      startNewHand: jest.fn(),
    };

    bettingService = {
      calculateMinRaise: jest.fn().mockReturnValue(20),
      processAction: jest.fn().mockResolvedValue(undefined),
      isBettingRoundComplete: jest.fn().mockReturnValue(true),
      validateAction: jest.fn((room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: true };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      }),
    };

    testDeckService = {
      isTestMode: jest.fn().mockReturnValue(false),
    };

    robotAgentService = {
      isConfigured: jest.fn().mockReturnValue(false),
      getConfigurationError: jest.fn().mockReturnValue(null),
      decideAction: jest.fn(),
    };

    gateway = new EventsGateway(
      gameService,
      handService,
      bettingService,
      testDeckService,
      robotAgentService,
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
        listRoomsWithChatData: jest.fn().mockResolvedValue([]),
        pruneRoomMessages: jest.fn().mockResolvedValue({
          deleted: 0,
          remaining: 0,
        }),
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

    (gateway as any).socketToPlayer.set('socket-host', {
      roomId: 'ROOM1',
      playerId: 'p-host',
    });
  });

  it('adds a robot, broadcasts join, and updates ready state', async () => {
    const host = createPlayer({
      id: 'p-host',
      socketId: 'socket-host',
      name: 'Host',
      status: 'waiting',
      position: 0,
    });
    const robot = createPlayer({
      id: 'p-robot',
      socketId: '',
      name: 'Robot 1',
      status: 'waiting',
      position: 1,
      isRobot: true,
    });
    const room = {
      id: 'ROOM1',
      hostId: 'p-host',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [host, robot],
      gameState: 'WAITING',
      currentHand: null,
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    gameService.addRobotToRoom.mockResolvedValue({ room, player: robot });

    const response = await gateway.handleAddRobotPlayer(
      createClient('socket-host'),
      {},
    );

    expect(response).toEqual({ success: true, playerId: 'p-robot' });
    expect(gameService.addRobotToRoom).toHaveBeenCalledWith(
      'ROOM1',
      'p-host',
      undefined,
      undefined,
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith('PLAYER_JOINED', {
      player: expect.objectContaining({
        id: 'p-robot',
        name: 'Robot 1',
        isRobot: true,
        cards: undefined,
      }),
    });
    expect(roomEmitter.emit).toHaveBeenCalledWith('READY_STATE_UPDATED', {
      phase: 'START_GAME',
      readyPlayerIds: ['p-robot'],
    });
    expect(storageService.persistRoom).toHaveBeenCalledWith(
      room,
      expect.objectContaining({
        events: [
          expect.objectContaining({
            type: 'READY_STATE_UPDATED',
            payload: {
              phase: 'START_GAME',
              readyPlayerIds: ['p-robot'],
            },
          }),
        ],
      }),
    );
  });

  it('removes a robot, broadcasts leave, and clears robot ready state', async () => {
    const host = createPlayer({
      id: 'p-host',
      socketId: 'socket-host',
      name: 'Host',
      status: 'waiting',
      position: 0,
    });
    const robot = createPlayer({
      id: 'p-robot',
      socketId: '',
      name: 'Robot 1',
      status: 'waiting',
      position: 1,
      isRobot: true,
    });
    const roomBeforeRemoval = {
      id: 'ROOM1',
      hostId: 'p-host',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [host, robot],
      gameState: 'WAITING',
      currentHand: null,
      readyPhase: 'START_GAME',
      readyPlayerIds: ['p-robot'],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const roomAfterRemoval = {
      ...roomBeforeRemoval,
      players: [host, { ...robot, status: 'left' }],
      readyPlayerIds: ['p-robot'],
    };

    storageService.getRoom.mockResolvedValue(roomBeforeRemoval);
    gameService.removeRobotFromRoom.mockResolvedValue(roomAfterRemoval);

    const response = await gateway.handleRemoveRobotPlayer(
      createClient('socket-host'),
      { playerId: 'p-robot' },
    );

    expect(response).toEqual({ success: true });
    expect(gameService.removeRobotFromRoom).toHaveBeenCalledWith(
      'ROOM1',
      'p-host',
      'p-robot',
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith('PLAYER_LEFT', {
      playerId: 'p-robot',
      playerName: 'Robot 1',
    });
    expect(roomEmitter.emit).toHaveBeenCalledWith('READY_STATE_UPDATED', {
      phase: 'START_GAME',
      readyPlayerIds: [],
    });
    expect(storageService.persistRoom).toHaveBeenCalledWith(
      roomAfterRemoval,
      expect.objectContaining({
        events: [
          expect.objectContaining({
            type: 'READY_STATE_UPDATED',
            payload: {
              phase: 'START_GAME',
              readyPlayerIds: [],
            },
          }),
        ],
      }),
    );
  });

  it('auto-readies robots during NEXT_HAND phase without requiring client input', () => {
    const host = createPlayer({
      id: 'p-host',
      socketId: 'socket-host',
      name: 'Host',
      status: 'connected',
      position: 0,
    });
    const robot = createPlayer({
      id: 'p-robot',
      socketId: '',
      name: 'Robot 1',
      status: 'waiting',
      position: 1,
      isRobot: true,
    });
    const room = {
      id: 'ROOM1',
      hostId: 'p-host',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [host, robot],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 7,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: null,
        pot: 0,
        communityCards: [],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 20,
        activePlayers: [],
        roundActions: {},
        sidePots: [],
        potContributions: {},
        vpipPlayerIds: [],
        lastResult: {
          winners: [],
          playerHands: [],
          totalPot: 0,
          payouts: [],
          netByPlayerId: {},
        },
      },
      readyPhase: null,
      readyPlayerIds: ['p-host'],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    (gateway as any).syncRoomReadyState(room);

    expect(room.readyPhase).toBe('NEXT_HAND');
    expect(room.readyPlayerIds).toEqual(['p-host', 'p-robot']);
  });

  it('passes provider-backed robot decision metadata into persisted player actions', async () => {
    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        robotPersonality: 'chaotic',
      }),
      isRobot: true,
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 20,
      cards: [
        { rank: '2', suit: 'clubs' },
        { rank: '2', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 9,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 15,
        communityCards: [
          { rank: 'Q', suit: 'spades' },
          { rank: 'J', suit: 'spades' },
          { rank: '3', suit: 'clubs' },
        ],
        bettingRound: 'FLOP',
        currentBet: 10,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 5, 'p-human': 10 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [
        { ...robot, lastAction: 'raise', currentBet: 30, chips: 970 },
        human,
      ],
      currentHand: {
        ...room.currentHand,
        pot: 35,
        currentBet: 30,
      },
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(true);
    robotAgentService.decideAction.mockResolvedValue({
      action: 'raise',
      amount: 20,
      persistedDecision: {
        source: 'provider-output',
        summary: 'Provider final output accepted.',
        validationRetryCount: 0,
      },
    });
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 9);

    expect(robotAgentService.decideAction).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          personality: expect.objectContaining({
            key: 'chaotic',
          }),
        }),
      }),
    );
    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
        currentHand: expect.objectContaining({
          handNumber: 9,
          currentPlayerTurn: 'p-robot',
        }),
      }),
      'p-robot',
      'raise',
      20,
      expect.objectContaining({
        actionId: expect.stringMatching(/^robot-9-/),
        robotDecision: {
          source: 'provider-output',
          summary: 'Provider final output accepted.',
          validationRetryCount: 0,
        },
      }),
    );
  });

  it('passes fallback robot decision metadata into persisted player actions when provider execution fails', async () => {
    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
      }),
      isRobot: true,
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
      ],
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      cards: [
        { rank: '2', suit: 'clubs' },
        { rank: '2', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 9,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 15,
        communityCards: [
          { rank: 'Q', suit: 'spades' },
          { rank: 'J', suit: 'spades' },
          { rank: '3', suit: 'clubs' },
        ],
        bettingRound: 'FLOP',
        currentBet: 10,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 5, 'p-human': 10 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'check' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(true);
    robotAgentService.decideAction.mockRejectedValue(
      new RobotDecisionError(
        'invalid-final-action',
        'Robot agent produced an invalid final action',
        2,
      ),
    );
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 9);

    expect(robotAgentService.decideAction).toHaveBeenCalled();
    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
        currentHand: expect.objectContaining({
          handNumber: 9,
          currentPlayerTurn: 'p-robot',
        }),
      }),
      'p-robot',
      'check',
      undefined,
      expect.objectContaining({
        actionId: expect.stringMatching(/^robot-9-/),
        robotDecision: {
          source: 'deterministic-fallback',
          fallbackCause: 'invalid-final-action',
          summary:
            'Deterministic fallback check because invalid final action after 2 validation retries.',
          validationRetryCount: 2,
        },
      }),
    );
  });

  it('uses bully fallback to apply pressure with a legal raise in unopened strong spots', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string, amount?: number) => {
        void room;
        void playerId;
        if (action === 'raise') {
          return amount === 20
            ? { valid: true }
            : { valid: false, reason: 'Raise must use 20 chips' };
        }
        return { valid: action !== 'fold' };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'bully',
      }),
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 10,
      cards: [
        { rank: '2', suit: 'clubs' },
        { rank: '2', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 11,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 20,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 10,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 10 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [
        { ...robot, lastAction: 'raise', currentBet: 30, chips: 980 },
        human,
      ],
      currentHand: {
        ...room.currentHand,
        pot: 40,
        currentBet: 30,
      },
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 11);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'raise',
      20,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('uses tight fallback to check behind instead of forcing a raise in the same spot', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string, amount?: number) => {
        void room;
        void playerId;
        if (action === 'raise') {
          return amount === 20
            ? { valid: true }
            : { valid: false, reason: 'Raise must use 20 chips' };
        }
        return { valid: action !== 'fold' };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'tight',
      }),
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 10,
      cards: [
        { rank: '2', suit: 'clubs' },
        { rank: '2', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 12,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 20,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 10,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 10 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'check' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 12);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'check',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('uses balanced fallback to defend top pair against a large raise when the price is still reasonable', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'balanced',
      }),
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'Q', suit: 'clubs' },
      ],
      currentBet: 20,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 200,
      cards: [
        { rank: 'K', suit: 'diamonds' },
        { rank: 'J', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 12_1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 420,
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: '9', suit: 'clubs' },
          { rank: '4', suit: 'diamonds' },
        ],
        bettingRound: 'FLOP',
        currentBet: 200,
        lastRaiseSize: 120,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 20, 'p-human': 200 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'call' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 121);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'call',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('uses tight fallback to fold the same large-raise top-pair spot that balanced will defend', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'tight',
      }),
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'Q', suit: 'clubs' },
      ],
      currentBet: 20,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 200,
      cards: [
        { rank: 'K', suit: 'diamonds' },
        { rank: 'J', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 12_2,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 420,
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: '9', suit: 'clubs' },
          { rank: '4', suit: 'diamonds' },
        ],
        bettingRound: 'FLOP',
        currentBet: 200,
        lastRaiseSize: 120,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 20, 'p-human': 200 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'fold', status: 'folded' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 122);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'fold',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('folds weak suited trash pre-flop instead of defending just because stacks are deep', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'balanced',
      }),
      cards: [
        { rank: '7', suit: 'hearts' },
        { rank: '2', suit: 'hearts' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 100,
      cards: [
        { rank: 'A', suit: 'clubs' },
        { rank: 'K', suit: 'clubs' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 12_3,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 150,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 100,
        lastRaiseSize: 80,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 100 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'fold', status: 'folded' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 123);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'fold',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('folds strong but non-premium hands when facing extreme pressure', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'balanced',
      }),
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: '10', suit: 'diamonds' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 700,
      cards: [
        { rank: 'K', suit: 'clubs' },
        { rank: 'Q', suit: 'clubs' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 12_4,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 780,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 700,
        lastRaiseSize: 680,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 700 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'fold', status: 'folded' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 124);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'fold',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('uses all-in instead of a min-raise for bully fallback with a strong short stack', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string, amount?: number) => {
        void room;
        void playerId;
        if (action === 'raise') {
          return amount === 20
            ? { valid: true }
            : { valid: false, reason: 'Raise must use 20 chips' };
        }
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'bully',
      }),
      chips: 60,
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 40,
      cards: [
        { rank: 'K', suit: 'clubs' },
        { rank: 'Q', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 13,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 50,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 40,
        lastRaiseSize: 20,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 40 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'all-in', chips: 0 }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 13);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'all-in',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('lets chaotic fallback peel a very cheap weak-hand price occasionally', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'chaotic',
      }),
      cards: [
        { rank: '7', suit: 'clubs' },
        { rank: '2', suit: 'diamonds' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 20,
      cards: [
        { rank: 'A', suit: 'hearts' },
        { rank: 'K', suit: 'hearts' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 13_1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 100,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 20,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 20 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'call' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 131);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'call',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('treats an underpair as weak and folds instead of continuing like top pair', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'tight',
      }),
      cards: [
        { rank: '2', suit: 'spades' },
        { rank: '2', suit: 'clubs' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 20,
      cards: [
        { rank: 'A', suit: 'diamonds' },
        { rank: 'K', suit: 'diamonds' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 14,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 30,
        communityCards: [
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'clubs' },
          { rank: '9', suit: 'spades' },
        ],
        bettingRound: 'FLOP',
        currentBet: 20,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 20 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'fold', status: 'folded' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 14);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'fold',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });

  it('does not mistake a board-only four-flush for the robot drawing hand', async () => {
    bettingService.validateAction.mockImplementation(
      (room: any, playerId: string, action: string) => {
        void room;
        void playerId;
        if (action === 'check') {
          return { valid: false, reason: 'Cannot check facing a bet' };
        }
        if (action === 'raise') {
          return { valid: false, reason: 'Raise unavailable' };
        }
        return { valid: true };
      },
    );

    const robot = {
      ...createPlayer({
        id: 'p-robot',
        socketId: '',
        name: 'Robot 1',
        status: 'connected',
        position: 0,
        isRobot: true,
        robotPersonality: 'balanced',
      }),
      cards: [
        { rank: 'Q', suit: 'clubs' },
        { rank: 'J', suit: 'spades' },
      ],
      currentBet: 10,
    };
    const human = {
      ...createPlayer({
        id: 'p-human',
        socketId: 'socket-human',
        name: 'Human',
        status: 'connected',
        position: 1,
      }),
      currentBet: 20,
      cards: [
        { rank: 'A', suit: 'clubs' },
        { rank: 'K', suit: 'clubs' },
      ],
    };
    const room = {
      id: 'ROOM1',
      hostId: 'p-human',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [robot, human],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 15,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-robot',
        pot: 30,
        communityCards: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' },
          { rank: '9', suit: 'hearts' },
          { rank: '2', suit: 'hearts' },
        ],
        bettingRound: 'TURN',
        currentBet: 20,
        lastRaiseSize: 10,
        activePlayers: ['p-robot', 'p-human'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-robot': 10, 'p-human': 20 },
        vpipPlayerIds: ['p-robot', 'p-human'],
        revealedPlayerIds: [],
      },
      readyPhase: null,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    const updatedRoom = {
      ...room,
      players: [{ ...robot, lastAction: 'fold', status: 'folded' }, human],
    };

    storageService.getRoom
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(room)
      .mockResolvedValueOnce(updatedRoom);
    robotAgentService.isConfigured.mockReturnValue(false);
    jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 15);

    expect(bettingService.processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ROOM1',
      }),
      'p-robot',
      'fold',
      undefined,
      expect.objectContaining({
        robotDecision: expect.objectContaining({
          source: 'deterministic-fallback',
          fallbackCause: 'provider-unavailable',
        }),
      }),
    );
  });
});
