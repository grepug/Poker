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
  let roomEmitter: any;
  let persistViaStaleSnapshot: (mutate: (draft: any) => void) => Promise<any>;

  const createPlayer = (params: {
    id: string;
    socketId: string;
    name: string;
    status: string;
    position: number;
    userId?: string;
  }) => ({
    id: params.id,
    socketId: params.socketId,
    userId: params.userId,
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
          userId: 'user-alice',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'disconnected',
          position: 1,
          userId: 'user-bob',
        }),
      ],
      gameState: 'IN_PROGRESS',
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    persistViaStaleSnapshot = async (mutate: (draft: any) => void) => {
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
            player.connectionStatus = 'connected';
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
            player.connectionStatus = 'disconnected';
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
      markPlayerDisconnected: jest.fn(async (roomId: string, playerId: string) => {
        if (roomId !== 'ROOM1') {
          return null;
        }

        let updatedRoom: any = null;
        await persistViaStaleSnapshot((draft) => {
          const player = draft.players.find((entry: any) => entry.id === playerId);
          if (!player) {
            return;
          }

          player.connectionStatus = 'disconnected';
          draft.lastActivityAt = Date.now();
          updatedRoom = deepClone(draft);
        });

        return updatedRoom;
      }),
      transferHostOnDisconnectTimeout: jest.fn(async (roomId: string, playerId: string) => {
        if (roomId !== 'ROOM1') {
          return null;
        }

        let updatedRoom: any = null;
        await persistViaStaleSnapshot((draft) => {
          if (draft.hostId !== playerId) {
            updatedRoom = deepClone(draft);
            return;
          }

          const nextHost = draft.players.find(
            (entry: any) =>
              entry.id !== playerId &&
              !entry.isRobot &&
              entry.status !== 'left' &&
              entry.connectionStatus !== 'disconnected',
          );
          if (!nextHost) {
            updatedRoom = deepClone(draft);
            return;
          }

          draft.hostId = nextHost.id;
          draft.lastActivityAt = Date.now();
          updatedRoom = deepClone(draft);
        });

        return updatedRoom;
      }),
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
      archiveEndedRoom: jest.fn().mockResolvedValue({ archiveId: 'ROOM1' }),
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
      { scheduleArchiveReview: jest.fn().mockResolvedValue(undefined) } as any,
      authService,
      storageService,
      storageService as any,
      chatStorageService,
      chatMediaStorageService,
    );

    roomEmitter = { emit: jest.fn() };
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

  it('evicts the old socket when the same authenticated user joins from another device', async () => {
    roomState.players[1].status = 'connected';
    roomState.players[1].connectionStatus = 'connected';

    gameService.addPlayerToRoom.mockImplementationOnce(
      async (roomId: string, socketId: string) => {
        if (roomId !== 'ROOM1') {
          throw new Error('Room not found');
        }

        let updatedPlayer: any = null;
        const room = await persistViaStaleSnapshot((draft) => {
          const player = draft.players.find((entry: any) => entry.id === 'p-bob');
          if (!player) {
            throw new Error('Player not found');
          }

          player.socketId = socketId;
          player.connectionStatus = 'connected';
          player.lastConnectedAt = Date.now();
          draft.lastActivityAt = Date.now();
          updatedPlayer = deepClone(player);
        });

        return { room, player: updatedPlayer, rejoined: true };
      },
    );

    const displacedClient = createClient('socket-bob-old', {
      cookieToken: 'token-bob',
    });
    const takeoverClient = createClient('socket-bob-new', {
      cookieToken: 'token-bob',
    });
    (gateway as any).socketToPlayer.set('socket-bob-old', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });
    (gateway.server as any).sockets.sockets.set('socket-bob-old', displacedClient);

    const result = await gateway.handleJoinRoom(takeoverClient as any, {
      roomId: 'ROOM1',
      playerName: 'Bob',
    });

    expect(result).toEqual({ success: true });
    expect(displacedClient.emit).toHaveBeenCalledWith(
      'SESSION_DISPLACED',
      expect.objectContaining({
        roomId: 'ROOM1',
        playerId: 'p-bob',
      }),
    );
    expect(displacedClient.leave).toHaveBeenCalledWith('ROOM1');
    expect(takeoverClient.join).toHaveBeenCalledWith('ROOM1');
    expect((gateway as any).socketToPlayer.get('socket-bob-new')).toEqual({
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });
    expect((gateway as any).socketToPlayer.has('socket-bob-old')).toBe(false);
  });

  it('uses tracked room metadata when displacing a stale socket mapping', () => {
    const displacedClient = createClient('socket-bob-old', {
      cookieToken: 'token-bob',
    });
    (gateway as any).socketToPlayer.set('socket-bob-old', {
      roomId: 'ROOM2',
      playerId: 'p-bob',
    });
    (gateway.server as any).sockets.sockets.set('socket-bob-old', displacedClient);

    (gateway as any).displacePlayerSocket('ROOM1', 'p-bob', 'socket-bob-new');

    expect(displacedClient.emit).toHaveBeenCalledWith(
      'SESSION_DISPLACED',
      expect.objectContaining({
        roomId: 'ROOM2',
        playerId: 'p-bob',
      }),
    );
    expect(displacedClient.leave).toHaveBeenCalledWith('ROOM2');
    expect((gateway as any).socketToPlayer.has('socket-bob-old')).toBe(false);
  });

  it('allows leave between hands before the player readies the next hand', async () => {
    roomState.players[1].status = 'waiting';
    roomState.players[1].connectionStatus = 'connected';
    roomState.readyPhase = 'NEXT_HAND';
    roomState.readyPlayerIds = [];
    roomState.currentHand = {
      handNumber: 1,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 1,
      pot: 10,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob'],
      bettingRound: 'RIVER',
      currentBet: 10,
      currentPlayerTurn: null,
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
      lastResult: {
        winners: [],
        playerHands: [],
        pot: 10,
        timestamp: Date.now(),
      },
    };

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
    expect(bettingService.isBettingRoundComplete).not.toHaveBeenCalled();
    expect(handleBettingRoundCompleteSpy).not.toHaveBeenCalled();
    expect(leavingClient.leave).toHaveBeenCalledWith('ROOM1');
  });

  it('treats leave from a missing room as successful local cleanup', async () => {
    storageService.getRoom.mockResolvedValue(null);
    const leavingClient = createClient('socket-bob-old', {
      cookieToken: 'token-bob',
    });
    (gateway as any).socketToPlayer.set('socket-bob-old', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });

    const result = await gateway.handleLeaveRoom(leavingClient as any);

    expect(result).toEqual({ success: true });
    expect(leavingClient.leave).toHaveBeenCalledWith('ROOM1');
    expect(gameService.removePlayerFromRoom).not.toHaveBeenCalled();
    expect((gateway as any).socketToPlayer.has('socket-bob-old')).toBe(false);
    expect(leavingClient.emit).not.toHaveBeenCalledWith('ERROR', expect.anything());
  });

  it('rejects leave while a hand is still in progress', async () => {
    roomState.players[1].status = 'connected';
    roomState.players[1].connectionStatus = 'connected';
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
      roundActions: { 'p-bob': true },
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

    const leavingClient = createClient('socket-bob-old', {
      cookieToken: 'token-bob',
    });
    (gateway as any).socketToPlayer.set('socket-bob-old', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });

    const result = await gateway.handleLeaveRoom(leavingClient as any);

    expect(result).toEqual({
      success: false,
      error: 'You can only leave the room between hands or after the game ends',
    });
    expect(gameService.removePlayerFromRoom).not.toHaveBeenCalled();
    expect(leavingClient.leave).not.toHaveBeenCalled();
  });

  it('rejects leave after the player has already readied the next hand', async () => {
    roomState.players[1].status = 'waiting';
    roomState.players[1].connectionStatus = 'connected';
    roomState.readyPhase = 'NEXT_HAND';
    roomState.readyPlayerIds = ['p-bob'];
    roomState.currentHand = {
      handNumber: 3,
      dealerPosition: 0,
      smallBlindPosition: 1,
      bigBlindPosition: 0,
      pot: 40,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob'],
      bettingRound: 'RIVER',
      currentBet: 20,
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
        playerHands: [],
        pot: 40,
        timestamp: Date.now(),
      },
    };

    const leavingClient = createClient('socket-bob-old', {
      cookieToken: 'token-bob',
    });
    (gateway as any).socketToPlayer.set('socket-bob-old', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });

    const result = await gateway.handleLeaveRoom(leavingClient as any);

    expect(result).toEqual({
      success: false,
      error: 'You already marked ready for the next hand',
    });
    expect(gameService.removePlayerFromRoom).not.toHaveBeenCalled();
    expect(leavingClient.leave).not.toHaveBeenCalled();
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
        userId: 'user-alice',
      }),
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: '',
          name: 'Bob',
          status: 'left',
          position: 1,
          userId: 'user-bob',
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
    expect(storageService.archiveEndedRoom).toHaveBeenCalledWith('ROOM1');
    expect(
      (gateway as any).savedGameReviewService.scheduleArchiveReview,
    ).toHaveBeenCalledWith('ROOM1');
  });

  it('excludes zero-activity left robots from end-game standings', async () => {
    roomState.players = [
      createPlayer({
        id: 'p-host',
        socketId: 'socket-host',
        name: 'Host',
        status: 'connected',
        position: 0,
        userId: 'user-alice',
      }),
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: '',
          name: 'Bob',
          status: 'left',
          position: 1,
          userId: 'user-bob',
        }),
        chips: 425,
        totalBuyIn: 1000,
      },
      {
        ...createPlayer({
          id: 'p-robot-idle',
          socketId: '',
          name: 'Robot 1',
          status: 'left',
          position: 2,
        }),
        isRobot: true,
        chips: 0,
        totalBuyIn: 0,
        handsPlayedCount: 0,
        handsWonCount: 0,
        vpipHandsCount: 0,
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
    const gameEndedPayload = (gateway.server.to as jest.Mock).mock.results
      .map((result) => result.value.emit.mock.calls)
      .flat()
      .find(([eventName]) => eventName === 'GAME_ENDED')?.[1];

    expect(gameEndedPayload?.standings).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          playerId: 'p-robot-idle',
        }),
      ]),
    );
    expect(gameEndedPayload?.standings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: 'p-host',
        }),
        expect.objectContaining({
          playerId: 'p-bob',
        }),
      ]),
    );
  });

  it('auto-finalizes and archives an abandoned room between hands after disconnect timeout', async () => {
    roomState.hostId = 'p-host';
    roomState.gameState = 'IN_PROGRESS';
    roomState.players = [
      {
        ...createPlayer({
          id: 'p-host',
          socketId: 'socket-host',
          name: 'Host',
          status: 'waiting',
          position: 0,
          userId: 'user-alice',
        }),
        connectionStatus: 'disconnected',
      },
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'waiting',
          position: 1,
          userId: 'user-bob',
        }),
        connectionStatus: 'disconnected',
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
    (gateway as any).abandonedRoomSince.set(
      'ROOM1',
      Date.now() - roomState.config.reconnectGracePeriod - 1,
    );

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(storageService.archiveEndedRoom).toHaveBeenCalledWith('ROOM1');
    expect(
      (gateway as any).savedGameReviewService.scheduleArchiveReview,
    ).toHaveBeenCalledWith('ROOM1');
    const savedRoom = storageService.persistRoom.mock.calls.at(-1)?.[0];
    expect(savedRoom?.gameState).toBe('ENDED');
  });

  it('does not auto-finalize after disconnect timeout while another human is still connected', async () => {
    roomState.hostId = 'p-host';
    roomState.gameState = 'IN_PROGRESS';
    roomState.players = [
      {
        ...createPlayer({
          id: 'p-host',
          socketId: 'socket-host',
          name: 'Host',
          status: 'waiting',
          position: 0,
          userId: 'user-alice',
        }),
        connectionStatus: 'disconnected',
      },
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'waiting',
          position: 1,
          userId: 'user-bob',
        }),
        connectionStatus: 'connected',
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
    (gateway as any).abandonedRoomSince.set(
      'ROOM1',
      Date.now() - roomState.config.reconnectGracePeriod - 1,
    );

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(storageService.archiveEndedRoom).not.toHaveBeenCalled();
    expect(
      (gateway as any).savedGameReviewService.scheduleArchiveReview,
    ).not.toHaveBeenCalled();
    expect((gateway as any).abandonedRoomSince.has('ROOM1')).toBe(false);
  });

  it('does not auto-finalize an abandoned room while a hand is still in progress', async () => {
    roomState.hostId = 'p-host';
    roomState.gameState = 'IN_PROGRESS';
    roomState.players = [
      {
        ...createPlayer({
          id: 'p-host',
          socketId: 'socket-host',
          name: 'Host',
          status: 'connected',
          position: 0,
          userId: 'user-alice',
        }),
        connectionStatus: 'disconnected',
      },
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'connected',
          position: 1,
          userId: 'user-bob',
        }),
        connectionStatus: 'disconnected',
      },
    ];
    roomState.currentHand = {
      handNumber: 4,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 1,
      pot: 15,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob'],
      bettingRound: 'PRE_FLOP',
      currentBet: 10,
      currentPlayerTurn: 'p-bob',
      roundActions: { 'p-host': true },
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
    (gateway as any).abandonedRoomSince.set(
      'ROOM1',
      Date.now() - roomState.config.reconnectGracePeriod - 1,
    );

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(storageService.archiveEndedRoom).not.toHaveBeenCalled();
    const savedRoom = storageService.persistRoom.mock.calls.at(-1)?.[0];
    expect(savedRoom?.gameState).toBe('IN_PROGRESS');
  });

  it('clears abandoned-room tracking when a player reconnects before finalization', async () => {
    (gateway as any).abandonedRoomSince.set(
      'ROOM1',
      Date.now() - roomState.config.reconnectGracePeriod - 1,
    );
    const reconnectClient = createClient('socket-reconnect', {
      cookieToken: 'token-bob',
    });

    const reconnectResult = await gateway.handleReconnect(reconnectClient as any, {
      roomId: 'ROOM1',
      playerName: 'Bob',
      playerId: 'p-bob',
    });

    expect(reconnectResult).toEqual({ success: true });
    expect((gateway as any).abandonedRoomSince.has('ROOM1')).toBe(false);
  });

  it('auto-finalizes after run-count timeout resolution reaches a safe paused phase', async () => {
    roomState.hostId = 'p-host';
    roomState.gameState = 'IN_PROGRESS';
    roomState.players = [
      {
        ...createPlayer({
          id: 'p-host',
          socketId: 'socket-host',
          name: 'Host',
          status: 'connected',
          position: 0,
          userId: 'user-alice',
        }),
        connectionStatus: 'disconnected',
      },
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'connected',
          position: 1,
          userId: 'user-bob',
        }),
        connectionStatus: 'disconnected',
      },
    ];
    roomState.currentHand = {
      handNumber: 4,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 1,
      pot: 20,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob'],
      bettingRound: 'TURN',
      currentBet: 10,
      currentPlayerTurn: 'p-bob',
      roundActions: { 'p-host': true },
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
      runCountDecision: {
        requestedByPlayerId: 'p-bob',
        eligiblePlayerIds: ['p-host', 'p-bob'],
        twiceAgreedPlayerIds: ['p-bob'],
        currentSelectionByPlayerId: {},
        expiresAt: Date.now() + 5000,
      },
    };
    (gateway as any).abandonedRoomSince.set(
      'ROOM1',
      Date.now() - roomState.config.reconnectGracePeriod - 1,
    );

    jest
      .spyOn(gateway as any, 'resolveRunCountDecision')
      .mockImplementation(async () => {
        roomState.currentHand = {
          ...roomState.currentHand,
          bettingRound: 'SHOWDOWN',
          currentPlayerTurn: null,
          runCountDecision: null,
          lastResult: {
            winners: [],
            winningHand: null,
            potAmount: 20,
            playerHands: [],
          },
        };
      });

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(storageService.archiveEndedRoom).toHaveBeenCalledWith('ROOM1');
    expect(
      (gateway as any).savedGameReviewService.scheduleArchiveReview,
    ).toHaveBeenCalledWith('ROOM1');
  });

  it('clears abandoned-room tracking during module teardown', () => {
    (gateway as any).abandonedRoomSince.set('ROOM1', Date.now());

    gateway.onModuleDestroy();

    expect((gateway as any).abandonedRoomSince.size).toBe(0);
  });

  it('treats stale disconnect timers as a no-op after the room has already ended', async () => {
    roomState.gameState = 'ENDED';
    roomState.currentHand = null;
    roomState.players[0].connectionStatus = 'disconnected';

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(gameService.markPlayerDisconnected).not.toHaveBeenCalled();
    expect(storageService.persistRoom).not.toHaveBeenCalled();
    expect(storageService.archiveEndedRoom).not.toHaveBeenCalled();
  });

  it('clears pending room disconnect timers when abandoned-room finalization succeeds', async () => {
    roomState.hostId = 'p-host';
    roomState.gameState = 'IN_PROGRESS';
    roomState.players = [
      {
        ...createPlayer({
          id: 'p-host',
          socketId: 'socket-host',
          name: 'Host',
          status: 'waiting',
          position: 0,
          userId: 'user-alice',
        }),
        connectionStatus: 'disconnected',
      },
      {
        ...createPlayer({
          id: 'p-bob',
          socketId: 'socket-bob-old',
          name: 'Bob',
          status: 'waiting',
          position: 1,
          userId: 'user-bob',
        }),
        connectionStatus: 'disconnected',
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
    (gateway as any).abandonedRoomSince.set(
      'ROOM1',
      Date.now() - roomState.config.reconnectGracePeriod - 1,
    );
    (gateway as any).disconnectTimers.set('p-host', setTimeout(() => {}, 1000));
    (gateway as any).disconnectTimers.set('p-bob', setTimeout(() => {}, 1000));

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect((gateway as any).disconnectTimers.size).toBe(0);
  });

  it('does not transfer disconnected host ownership while a hand is still live after timeout', async () => {
    roomState.players[0].connectionStatus = 'disconnected';
    roomState.currentHand = {
      handNumber: 5,
      dealerPosition: 0,
      smallBlindPosition: 1,
      bigBlindPosition: 0,
      pot: 30,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob'],
      bettingRound: 'PRE_FLOP',
      currentBet: 20,
      currentPlayerTurn: 'p-bob',
      roundActions: { 'p-host': true },
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

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(gameService.transferHostOnDisconnectTimeout).not.toHaveBeenCalled();
    expect(roomState.hostId).toBe('p-host');
    expect(roomEmitter.emit).not.toHaveBeenCalledWith(
      'HOST_CHANGED',
      expect.anything(),
    );
  });

  it('transfers disconnected host ownership after timeout when the room is between hands', async () => {
    roomState.players[0].connectionStatus = 'disconnected';
    roomState.players[1].status = 'waiting';
    roomState.players[1].connectionStatus = 'connected';
    roomState.players.push(
      createPlayer({
        id: 'p-charlie',
        socketId: 'socket-charlie',
        name: 'Charlie',
        status: 'waiting',
        position: 2,
        userId: 'user-charlie',
      }),
    );
    roomState.currentHand = {
      handNumber: 6,
      dealerPosition: 0,
      smallBlindPosition: 1,
      bigBlindPosition: 0,
      pot: 30,
      sidePots: [],
      communityCards: [],
      activePlayers: ['p-host', 'p-bob', 'p-charlie'],
      bettingRound: 'RIVER',
      currentBet: 20,
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
        playerHands: [],
        pot: 30,
        timestamp: Date.now(),
      },
    };

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-host');

    expect(gameService.transferHostOnDisconnectTimeout).toHaveBeenCalledWith(
      'ROOM1',
      'p-host',
    );
    expect(roomState.hostId).toBe('p-bob');
    expect(roomEmitter.emit).toHaveBeenCalledWith('HOST_CHANGED', {
      newHostId: 'p-bob',
      newHostName: 'Bob',
    });
  });
});
