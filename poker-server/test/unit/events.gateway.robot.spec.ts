import { EventsGateway } from '../../src/events/events.gateway';

describe('EventsGateway robot player controls', () => {
  let gateway: EventsGateway;
  let roomEmitter: { emit: jest.Mock };
  let gameService: any;
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
      saveRoom: jest.fn().mockResolvedValue(undefined),
    };

    gameService = {
      addRobotToRoom: jest.fn(),
      removeRobotFromRoom: jest.fn(),
    };

    gateway = new EventsGateway(
      gameService,
      {} as any,
      {} as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      {
        isConfigured: jest.fn().mockReturnValue(false),
        getConfigurationError: jest.fn().mockReturnValue(null),
        decideAction: jest.fn(),
      } as any,
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
    expect(storageService.saveRoom).toHaveBeenCalledWith(room);
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
    expect(storageService.saveRoom).toHaveBeenCalledWith(roomAfterRemoval);
  });
});
