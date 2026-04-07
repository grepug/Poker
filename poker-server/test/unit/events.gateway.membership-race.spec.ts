import { EventsGateway } from '../../src/events/events.gateway';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('EventsGateway membership mutation serialization', () => {
  let gateway: EventsGateway;
  let roomState: any;
  let gameService: any;
  let handService: any;
  let bettingService: any;
  let storageService: any;
  let chatStorageService: any;
  let chatMediaStorageService: any;
  let authService: any;

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

  const createClient = (
    socketId: string,
    options: { token?: string; cookieToken?: string },
  ) => ({
    id: socketId,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    handshake: {
      headers: options.cookieToken
        ? { cookie: `poker_session=${options.cookieToken}` }
        : {},
      auth: options.token ? { token: options.token } : {},
    },
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
      removePlayerFromRoom: jest.fn(
        async (roomId: string, playerId: string) => {
          if (roomId !== 'ROOM1') {
            return null;
          }

          let updatedRoom: any = null;
          await persistViaStaleSnapshot((draft) => {
            const player = draft.players.find(
              (entry: any) => entry.id === playerId,
            );
            if (!player) {
              return;
            }

            player.status = 'left';
            player.socketId = '';
            player.cards = null;
            player.currentBet = 0;
            player.lastAction = null;
            player.lastConnectedAt = Date.now();

            if (draft.currentHand) {
              draft.currentHand.activePlayers =
                draft.currentHand.activePlayers.filter(
                  (activePlayerId: string) => activePlayerId !== playerId,
                );

              if (draft.currentHand.roundActions?.[playerId]) {
                delete draft.currentHand.roundActions[playerId];
              }

              if (draft.currentHand.currentPlayerTurn === playerId) {
                draft.currentHand.currentPlayerTurn = null;
              }
            }

            draft.lastActivityAt = Date.now();
            updatedRoom = deepClone(draft);
          });

          return updatedRoom;
        },
      ),
    };

    handService = {
      getNextPlayer: jest.fn(),
    };

    bettingService = {
      isBettingRoundComplete: jest.fn().mockReturnValue(false),
    };

    storageService = {
      getRoom: jest.fn(async (roomId: string) => {
        if (roomId !== 'ROOM1') {
          return null;
        }
        return deepClone(roomState);
      }),
      persistRoom: jest.fn(),
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
      pruneRoomMessages: jest
        .fn()
        .mockResolvedValue({ deleted: 0, remaining: 0 }),
    };

    chatMediaStorageService = {
      saveVoiceClip: jest.fn(),
      deleteRoomMedia: jest.fn(),
      pruneOrphanMedia: jest.fn().mockResolvedValue({ deleted: 0 }),
    };
    authService = {
      getUserByToken: jest.fn(async (token: string) => {
        if (token === 'token-alice') {
          return {
            id: 'user-alice',
            accountId: 'alice',
            displayName: 'Alice',
            avatarEmoji: '🦊',
          };
        }
        if (token === 'token-bob') {
          return {
            id: 'user-bob',
            accountId: 'bob',
            displayName: 'Bob',
            avatarEmoji: '🐻',
          };
        }
        return null;
      }),
    };

    gateway = new EventsGateway(
      gameService,
      handService,
      bettingService,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      {
        isConfigured: jest.fn().mockReturnValue(false),
        getConfigurationError: jest
          .fn()
          .mockReturnValue('robot ai unavailable'),
        decideAction: jest.fn(),
      } as any,
      authService,
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

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  it('does not drop players when JOIN_ROOM and RECONNECT happen concurrently', async () => {
    const joinClient = createClient('socket-join', {
      cookieToken: 'token-alice',
    });
    const reconnectClient = createClient('socket-reconnect', {
      cookieToken: 'token-bob',
    });

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

  it('completes betting progression when a non-turn player leaves and hand is now complete', async () => {
    roomState.players[1].status = 'connected';
    roomState.currentHand = {
      handNumber: 1,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 1,
      pot: 10,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob'],
      bettingRound: 'PRE_FLOP',
      currentBet: 10,
      currentPlayerTurn: 'p-host',
      roundActions: { 'p-host': true, 'p-bob': true },
      lastRaiseSize: 10,
      deck: [],
      blindStructure: { smallBlind: 5, bigBlind: 10 },
      allInPlayers: [],
      winners: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      firstPlayerToAct: 'p-host',
      lastAggressor: null,
      pendingStreetRevealRound: null,
      nextStreetReadyPlayerIds: [],
      nextStreetRequiredPlayerIds: [],
      revealedPlayerIds: [],
      lastResult: null,
    };

    bettingService.isBettingRoundComplete.mockReturnValue(true);
    const handleBettingRoundCompleteSpy = jest
      .spyOn(gateway as any, 'handleBettingRoundComplete')
      .mockResolvedValue(undefined);

    const leavingClient = createClient('socket-bob-old', {
      cookieToken: 'token-bob',
    });
    (gateway as any).socketToPlayer.set('socket-bob-old', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });

    const result = await gateway.handleLeaveRoom(leavingClient as any);

    expect(result).toEqual({ success: true });
    expect(gameService.removePlayerFromRoom).toHaveBeenCalledWith(
      'ROOM1',
      'p-bob',
    );
    expect(bettingService.isBettingRoundComplete).toHaveBeenCalledTimes(1);
    expect(handleBettingRoundCompleteSpy).toHaveBeenCalledTimes(1);
    expect(leavingClient.leave).toHaveBeenCalledWith('ROOM1');
  });

  it('preserves left seats when ending a game between hands', async () => {
    roomState.hostId = 'p-host';
    roomState.gameState = 'IN_PROGRESS';
    roomState.players = [
      createPlayer({
        id: 'p-host',
        socketId: 'socket-host',
        name: 'Host',
        status: 'connected',
        position: 0,
      }),
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: '',
          name: 'Bob',
          status: 'left',
          position: 1,
        }),
        chips: 425,
        totalBuyIn: 1000,
      },
    ];
    roomState.currentHand = {
      handNumber: 4,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 1,
      pot: 0,
      sidePots: [],
      communityCards: [],
      activePlayers: [],
      bettingRound: 'SHOWDOWN',
      currentBet: 0,
      currentPlayerTurn: null,
      roundActions: {},
      lastRaiseSize: 10,
      deck: [],
      blindStructure: { smallBlind: 5, bigBlind: 10 },
      allInPlayers: [],
      winners: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      firstPlayerToAct: 'p-host',
      lastAggressor: null,
      pendingStreetRevealRound: null,
      nextStreetReadyPlayerIds: [],
      nextStreetRequiredPlayerIds: [],
      revealedPlayerIds: [],
      lastResult: {
        winners: [],
        winningHand: null,
        potAmount: 0,
        playerHands: [],
      },
    };

    (gateway as any).socketToPlayer.set('socket-host', {
      roomId: 'ROOM1',
      playerId: 'p-host',
    });
    const hostClient = createClient('socket-host', {
      cookieToken: 'token-alice',
    });

    const result = await gateway.handleEndGame(hostClient as any);

    expect(result).toEqual({ success: true });
    const savedRoom = storageService.persistRoom.mock.calls.at(-1)?.[0];
    expect(savedRoom?.gameState).toBe('ENDED');
    const leftSeat = savedRoom?.players.find((player: any) => player.id === 'p-bob');
    const hostSeat = savedRoom?.players.find((player: any) => player.id === 'p-host');
    expect(leftSeat?.status).toBe('left');
    expect(hostSeat?.status).toBe('waiting');
    expect(storageService.persistRoom).toHaveBeenCalled();
  });
});
