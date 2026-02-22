import { EventsGateway } from '../../src/events/events.gateway';

const createPlayer = (params: {
  id: string;
  name: string;
  status: string;
  position: number;
  socketId?: string;
}) => ({
  id: params.id,
  socketId: params.socketId ?? `socket-${params.id}`,
  name: params.name,
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

const createRoom = (params: {
  hostId: string;
  gameState: 'WAITING' | 'IN_PROGRESS';
  players: ReturnType<typeof createPlayer>[];
  currentHand?: Record<string, unknown> | null;
  readyPhase?: 'START_GAME' | 'NEXT_HAND' | null;
  readyPlayerIds?: string[];
}) => ({
  id: 'ROOM1',
  hostId: params.hostId,
  config: {
    startingChips: 1000,
    smallBlind: 5,
    bigBlind: 10,
    maxPlayers: 9,
    reconnectGracePeriod: 120000,
    allowPlayerStreetReveal: true,
  },
  players: params.players,
  gameState: params.gameState,
  currentHand: params.currentHand ?? null,
  readyPhase: params.readyPhase ?? 'START_GAME',
  readyPlayerIds: params.readyPlayerIds ?? [],
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
});

describe('EventsGateway randomize seats', () => {
  let gateway: EventsGateway;
  let gameService: any;
  let storageService: any;
  let roomEmitter: { emit: jest.Mock };

  beforeEach(() => {
    gameService = {
      shuffleSeatOrder: jest.fn(),
    };

    storageService = {
      getRoom: jest.fn(),
      saveRoom: jest.fn(),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(),
      roomExists: jest.fn(),
    };

    roomEmitter = { emit: jest.fn() };

    gateway = new EventsGateway(
      gameService,
      {} as any,
      {} as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
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
  });

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  it('allows host to randomize seats and emits seat update + ready state update', async () => {
    const roomBefore = createRoom({
      hostId: 'p-host',
      gameState: 'WAITING',
      players: [
        createPlayer({ id: 'p-host', name: 'Host', status: 'waiting', position: 0 }),
        createPlayer({ id: 'p-bob', name: 'Bob', status: 'connected', position: 1 }),
      ],
      readyPlayerIds: ['p-host'],
    });
    const shuffledRoom = createRoom({
      hostId: 'p-host',
      gameState: 'WAITING',
      players: [
        createPlayer({ id: 'p-host', name: 'Host', status: 'waiting', position: 1 }),
        createPlayer({ id: 'p-bob', name: 'Bob', status: 'connected', position: 0 }),
      ],
      readyPlayerIds: [],
    });

    storageService.getRoom.mockResolvedValue(roomBefore);
    gameService.shuffleSeatOrder.mockResolvedValue(shuffledRoom);

    const hostClient = {
      id: 'socket-host',
      emit: jest.fn(),
    } as any;

    (gateway as any).socketToPlayer.set('socket-host', {
      roomId: 'ROOM1',
      playerId: 'p-host',
    });

    const result = await gateway.handleRandomizeSeats(hostClient, {} as any);

    expect(result).toEqual({ success: true });
    expect(gameService.shuffleSeatOrder).toHaveBeenCalledWith('ROOM1');
    expect(gateway.server.to).toHaveBeenCalledWith('ROOM1');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'SEAT_ORDER_UPDATED',
      expect.objectContaining({
        shuffledByPlayerId: 'p-host',
        players: expect.arrayContaining([
          expect.objectContaining({ playerId: 'p-host', position: 1 }),
          expect.objectContaining({ playerId: 'p-bob', position: 0 }),
        ]),
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith('READY_STATE_UPDATED', {
      phase: 'START_GAME',
      readyPlayerIds: [],
    });
    expect(hostClient.emit).not.toHaveBeenCalledWith('ERROR', expect.anything());
  });

  it('rejects randomize seats when caller is not host', async () => {
    const room = createRoom({
      hostId: 'p-host',
      gameState: 'WAITING',
      players: [
        createPlayer({ id: 'p-host', name: 'Host', status: 'waiting', position: 0 }),
        createPlayer({ id: 'p-bob', name: 'Bob', status: 'connected', position: 1 }),
      ],
    });

    storageService.getRoom.mockResolvedValue(room);

    const bobClient = {
      id: 'socket-bob',
      emit: jest.fn(),
    } as any;
    (gateway as any).socketToPlayer.set('socket-bob', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });

    const result = await gateway.handleRandomizeSeats(bobClient, {} as any);

    expect(result).toEqual({
      success: false,
      error: 'Only host can randomize seats',
    });
    expect(gameService.shuffleSeatOrder).not.toHaveBeenCalled();
    expect(bobClient.emit).toHaveBeenCalledWith('ERROR', {
      message: 'Only host can randomize seats',
    });
  });

  it('allows host to randomize seats between hands and emits next-hand ready state reset', async () => {
    const roomBefore = createRoom({
      hostId: 'p-host',
      gameState: 'IN_PROGRESS',
      currentHand: {
        currentPlayerTurn: null,
        lastResult: { totalPot: 30 },
      },
      readyPhase: 'NEXT_HAND',
      players: [
        createPlayer({ id: 'p-host', name: 'Host', status: 'connected', position: 0 }),
        createPlayer({ id: 'p-bob', name: 'Bob', status: 'connected', position: 1 }),
      ],
      readyPlayerIds: ['p-host'],
    });
    const shuffledRoom = createRoom({
      hostId: 'p-host',
      gameState: 'IN_PROGRESS',
      currentHand: {
        currentPlayerTurn: null,
        lastResult: { totalPot: 30 },
      },
      readyPhase: 'NEXT_HAND',
      players: [
        createPlayer({ id: 'p-host', name: 'Host', status: 'connected', position: 1 }),
        createPlayer({ id: 'p-bob', name: 'Bob', status: 'connected', position: 0 }),
      ],
      readyPlayerIds: [],
    });

    storageService.getRoom.mockResolvedValue(roomBefore);
    gameService.shuffleSeatOrder.mockResolvedValue(shuffledRoom);

    const hostClient = {
      id: 'socket-host',
      emit: jest.fn(),
    } as any;
    (gateway as any).socketToPlayer.set('socket-host', {
      roomId: 'ROOM1',
      playerId: 'p-host',
    });

    const result = await gateway.handleRandomizeSeats(hostClient, {} as any);

    expect(result).toEqual({ success: true });
    expect(gameService.shuffleSeatOrder).toHaveBeenCalledWith('ROOM1');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'SEAT_ORDER_UPDATED',
      expect.objectContaining({
        shuffledByPlayerId: 'p-host',
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith('READY_STATE_UPDATED', {
      phase: 'NEXT_HAND',
      readyPlayerIds: [],
    });
  });

  it('rejects randomize seats during an active hand', async () => {
    const room = createRoom({
      hostId: 'p-host',
      gameState: 'IN_PROGRESS',
      currentHand: {
        currentPlayerTurn: 'p-host',
        lastResult: null,
      },
      players: [
        createPlayer({ id: 'p-host', name: 'Host', status: 'connected', position: 0 }),
        createPlayer({ id: 'p-bob', name: 'Bob', status: 'connected', position: 1 }),
      ],
    });

    storageService.getRoom.mockResolvedValue(room);

    const hostClient = {
      id: 'socket-host',
      emit: jest.fn(),
    } as any;
    (gateway as any).socketToPlayer.set('socket-host', {
      roomId: 'ROOM1',
      playerId: 'p-host',
    });

    const result = await gateway.handleRandomizeSeats(hostClient, {} as any);

    expect(result).toEqual({
      success: false,
      error: 'Seat order can only be changed before game starts or between hands',
    });
    expect(gameService.shuffleSeatOrder).not.toHaveBeenCalled();
    expect(hostClient.emit).toHaveBeenCalledWith('ERROR', {
      message: 'Seat order can only be changed before game starts or between hands',
    });
  });
});
