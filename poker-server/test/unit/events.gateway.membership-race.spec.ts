import { EventsGateway } from '../../src/events/events.gateway';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('EventsGateway membership mutation serialization', () => {
  let gateway: EventsGateway;
  let roomState: any;
  let gameService: any;
  let storageService: any;
  let chatStorageService: any;
  let chatMediaStorageService: any;

  const createPlayer = (params: {
    id: string;
    socketId: string;
    name: string;
    status: string;
    position: number;
  }) => ({
    id: params.id,
    socketId: params.socketId,
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

  const createClient = (socketId: string) => ({
    id: socketId,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    handshake: { headers: {} },
  });

  beforeEach(() => {
    roomState = {
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
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 'socket-host',
          name: 'Host',
          status: 'connected',
          position: 0,
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'disconnected',
          position: 1,
        }),
      ],
      gameState: 'IN_PROGRESS',
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const persistViaStaleSnapshot = async (mutate: (draft: any) => void) => {
      const snapshot = deepClone(roomState);
      await wait(25);
      mutate(snapshot);
      await wait(25);
      roomState = snapshot;
      return deepClone(roomState);
    };

    gameService = {
      addPlayerToRoom: jest.fn(
        async (roomId: string, socketId: string, playerName: string) => {
          if (roomId !== 'ROOM1') {
            throw new Error('Room not found');
          }

          const player = createPlayer({
            id: `p-${playerName.toLowerCase()}`,
            socketId,
            name: playerName,
            status: 'waiting',
            position: 2,
          });

          const room = await persistViaStaleSnapshot((draft) => {
            draft.players.push(player);
            draft.lastActivityAt = Date.now();
          });

          return { room, player, rejoined: false };
        },
      ),
      updatePlayerSocket: jest.fn(
        async (
          roomId: string,
          _playerName: string,
          newSocketId: string,
          playerId?: string,
        ) => {
          if (roomId !== 'ROOM1') {
            return null;
          }

          let updatedPlayer: any = null;
          await persistViaStaleSnapshot((draft) => {
            const player = draft.players.find((p: any) => p.id === playerId);
            if (!player) {
              return;
            }

            player.socketId = newSocketId;
            player.status = 'connected';
            player.lastConnectedAt = Date.now();
            draft.lastActivityAt = Date.now();
            updatedPlayer = deepClone(player);
          });

          return updatedPlayer;
        },
      ),
    };

    storageService = {
      getRoom: jest.fn(async (roomId: string) => {
        if (roomId !== 'ROOM1') {
          return null;
        }
        return deepClone(roomState);
      }),
      saveRoom: jest.fn(),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(),
      roomExists: jest.fn(),
    };

    chatStorageService = {
      getMessagePage: jest.fn().mockResolvedValue({
        messages: [],
        hasMore: false,
        nextBeforeSeq: null,
      }),
      appendMessage: jest.fn(),
      hasChatData: jest.fn(),
      deleteRoomChat: jest.fn(),
      listRoomsWithChatData: jest.fn().mockResolvedValue([]),
      pruneRoomMessages: jest.fn().mockResolvedValue({ deleted: 0, remaining: 0 }),
    };

    chatMediaStorageService = {
      saveVoiceClip: jest.fn(),
      deleteRoomMedia: jest.fn(),
      pruneOrphanMedia: jest.fn().mockResolvedValue({ deleted: 0 }),
    };

    gateway = new EventsGateway(
      gameService,
      {} as any,
      {} as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      storageService,
      chatStorageService,
      chatMediaStorageService,
    );

    const roomEmitter = { emit: jest.fn() };
    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      sockets: { sockets: new Map() },
    } as any;
  });

  it('does not drop players when JOIN_ROOM and RECONNECT happen concurrently', async () => {
    const joinClient = createClient('socket-join');
    const reconnectClient = createClient('socket-reconnect');

    const [joinResult, reconnectResult] = await Promise.all([
      gateway.handleJoinRoom(joinClient as any, {
        roomId: 'ROOM1',
        playerName: 'Alice',
      }),
      gateway.handleReconnect(reconnectClient as any, {
        roomId: 'ROOM1',
        playerName: 'Bob',
        playerId: 'p-bob',
      }),
    ]);

    expect(joinResult).toEqual({ success: true });
    expect(reconnectResult).toEqual({ success: true });
    expect(roomState.players).toHaveLength(3);

    const playerNames = roomState.players.map((p: any) => p.name).sort();
    expect(playerNames).toEqual(['Alice', 'Bob', 'Host']);

    const bob = roomState.players.find((p: any) => p.id === 'p-bob');
    expect(bob).toBeDefined();
    expect(bob.status).toBe('connected');
    expect(bob.socketId).toBe('socket-reconnect');

    expect(joinClient.join).toHaveBeenCalledWith('ROOM1');
    expect(reconnectClient.join).toHaveBeenCalledWith('ROOM1');
    expect(gameService.addPlayerToRoom).toHaveBeenCalledTimes(1);
    expect(gameService.updatePlayerSocket).toHaveBeenCalledTimes(1);
  });
});
