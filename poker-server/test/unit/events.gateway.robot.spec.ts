import { EventsGateway } from '../../src/events/events.gateway';

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
  }) => ({
    id: params.id,
    socketId: params.socketId,
    name: params.name,
    isRobot: params.isRobot ?? false,
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
    };

    handService = {
      startNewHand: jest.fn(),
    };

    bettingService = {
      calculateMinRaise: jest.fn().mockReturnValue(20),
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
      { getUserByToken: jest.fn() } as any,
      storageService,
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

  it('falls back to a deterministic legal action when robot provider execution fails', async () => {
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

    storageService.getRoom.mockResolvedValue(room);
    robotAgentService.isConfigured.mockReturnValue(true);
    robotAgentService.decideAction.mockRejectedValue(new Error('provider down'));
    const handlePlayerActionSpy = jest
      .spyOn(gateway as any, 'handlePlayerAction')
      .mockResolvedValue({ success: true });

    await (gateway as any).executeRobotTurn('ROOM1', 'p-robot', 9);

    expect(robotAgentService.decideAction).toHaveBeenCalled();
    expect(handlePlayerActionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^robot:ROOM1:p-robot:/),
      }),
      expect.objectContaining({
        action: 'check',
      }),
    );
  });
});
