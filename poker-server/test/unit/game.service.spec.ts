import { GameService } from '../../src/game/game.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player, GameStateType } from 'poker-types';

describe('GameService addPlayerToRoom', () => {
  let storageService: jest.Mocked<IStorageService>;
  let gameService: GameService;

  beforeEach(() => {
    storageService = {
      persistRoom: jest.fn().mockResolvedValue(undefined),
      getRoom: jest.fn().mockResolvedValue(null),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
      getAllRooms: jest.fn().mockResolvedValue([]),
      roomExists: jest.fn().mockResolvedValue(false),
    };

    gameService = new GameService(storageService);
  });

  function createPlayer(params: {
    id: string;
    socketId: string;
    name: string;
    position: number;
    chips: number;
    totalBuyIn: number;
    status: Player['status'];
  }): Player {
    return {
      id: params.id,
      socketId: params.socketId,
      name: params.name,
      chips: params.chips,
      totalBuyIn: params.totalBuyIn,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position: params.position,
      status: params.status,
      cards: null,
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };
  }

  function createRoom(params: {
    gameState: GameStateType;
    players: Player[];
    maxPlayers?: number;
    startingChips?: number;
    currentHand?: Room['currentHand'];
    hostId?: string;
  }): Room {
    return {
      id: 'ROOM01',
      hostId: params.hostId ?? params.players[0]?.id ?? 'host-id',
      config: {
        startingChips: params.startingChips ?? 1000,
        smallBlind: 10,
        bigBlind: 20,
        maxPlayers: params.maxPlayers ?? 10,
        reconnectGracePeriod: 30000,
        allowPlayerStreetReveal: true,
      },
      players: params.players,
      gameState: params.gameState,
      currentHand: params.currentHand ?? null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  it('creates room with standard rules by default', async () => {
    const room = await gameService.createRoom('socket-host', 'Alice');

    expect(room.config.useShortDeckRules).toBe(false);
    expect(room.config.maxPlayers).toBe(10);
    expect(room.players[0].name).toBe('Alice');
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it('respects explicit max player overrides when creating a room', async () => {
    const room = await gameService.createRoom('socket-host', 'Alice', '🦊', {
      maxPlayers: 4,
    });

    expect(room.config.maxPlayers).toBe(4);
    expect(storageService.persistRoom).toHaveBeenCalledWith(
      room,
      expect.anything(),
    );
  });

  it('rejects out-of-range max player overrides when creating a room', async () => {
    await expect(
      gameService.createRoom('socket-host', 'Alice', '🦊', {
        maxPlayers: 16,
      }),
    ).rejects.toThrow('maxPlayers must be an integer between 2 and 15');

    await expect(
      gameService.createRoom('socket-host', 'Alice', '🦊', {
        maxPlayers: 1,
      }),
    ).rejects.toThrow('maxPlayers must be an integer between 2 and 15');
  });

  it('rejects non-integer max player overrides when creating a room', async () => {
    await expect(
      gameService.createRoom('socket-host', 'Alice', '🦊', {
        maxPlayers: Number.NaN as unknown as number,
      }),
    ).rejects.toThrow('maxPlayers must be an integer between 2 and 15');

    await expect(
      gameService.createRoom('socket-host', 'Alice', '🦊', {
        maxPlayers: 7.5 as unknown as number,
      }),
    ).rejects.toThrow('maxPlayers must be an integer between 2 and 15');
  });

  it('creates room with short-deck rules when requested', async () => {
    const room = await gameService.createRoom('socket-host', 'Alice', '🦊', {
      useShortDeckRules: true,
    });

    expect(room.config.useShortDeckRules).toBe(true);
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it('adds joiner with zero chips while table is waiting', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-bob',
      'Bob',
      '😎',
    );

    expect(player.name).toBe('Bob');
    expect((player as any).emoji).toBe('😎');
    expect(player.chips).toBe(0);
    expect(player.totalBuyIn).toBe(0);
    expect(player.status).toBe('waiting');
    expect(room.players).toHaveLength(2);
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it('allows join while game is in progress and assigns starting chips as buy-in', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      startingChips: 1500,
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 1200,
          totalBuyIn: 2000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 's-bob',
          name: 'Bob',
          position: 1,
          chips: 800,
          totalBuyIn: 1000,
          status: 'connected',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-charlie',
      'Charlie',
    );

    expect(player.name).toBe('Charlie');
    expect(player.status).toBe('waiting');
    expect(player.chips).toBe(1500);
    expect(player.totalBuyIn).toBe(1500);
    expect(room.players).toHaveLength(3);
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it('rejects join when game has ended', async () => {
    const room = createRoom({
      gameState: 'ENDED',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addPlayerToRoom('ROOM01', 's-bob', 'Bob'),
    ).rejects.toThrow('Cannot join room - game has ended');
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('rejects duplicate player names', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addPlayerToRoom('ROOM01', 's-other', 'Alice'),
    ).rejects.toThrow('Name already taken');
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('reclaims disconnected player seat when joining with same name', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 's-old-bob',
          name: 'Bob',
          position: 1,
          chips: 850,
          totalBuyIn: 1000,
          status: 'disconnected',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player, rejoined } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-new-bob',
      'Bob',
      '🤠',
    );

    expect(rejoined).toBe(true);
    expect(player.id).toBe('p-bob');
    expect(player.socketId).toBe('s-new-bob');
    expect(player.status).toBe('connected');
    expect((player as any).emoji).toBe('🤠');
    expect(room.players).toHaveLength(2);
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it.each([
    ['folded', 'fold'],
    ['all-in', 'all-in'],
  ] as const)(
    'reclaims disconnected seat and preserves %s gameplay status',
    async (status, lastAction) => {
      const room = createRoom({
        gameState: 'IN_PROGRESS',
        players: [
          createPlayer({
            id: 'p-host',
            socketId: 's-host',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          {
            ...createPlayer({
              id: 'p-bob',
              socketId: 's-old-bob',
              name: 'Bob',
              position: 1,
              chips: status === 'all-in' ? 0 : 850,
              totalBuyIn: 1000,
              status,
            }),
            connectionStatus: 'disconnected',
            currentBet: status === 'all-in' ? 1000 : 150,
            lastAction,
          },
        ],
      });
      storageService.getRoom.mockResolvedValue(room);

      const { player, rejoined } = await gameService.addPlayerToRoom(
        'ROOM01',
        's-new-bob',
        'Bob',
      );

      expect(rejoined).toBe(true);
      expect(player.id).toBe('p-bob');
      expect(player.status).toBe(status);
      expect(player.connectionStatus).toBe('connected');
      expect(player.socketId).toBe('s-new-bob');
      expect(storageService.persistRoom).toHaveBeenCalledWith(
        room,
        expect.anything(),
      );
    },
  );

  it.each([
    ['folded', 'fold'],
    ['all-in', 'all-in'],
  ] as const)(
    'preserves %s status across disconnect and reconnect',
    async (status, lastAction) => {
      const room = createRoom({
        gameState: 'IN_PROGRESS',
        players: [
          createPlayer({
            id: 'p-host',
            socketId: 's-host',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          {
            ...createPlayer({
              id: 'p-bob',
              socketId: 's-bob',
              name: 'Bob',
              position: 1,
              chips: status === 'all-in' ? 0 : 850,
              totalBuyIn: 1000,
              status,
            }),
            currentBet: status === 'all-in' ? 1000 : 150,
            lastAction,
          },
        ],
      });
      storageService.getRoom.mockResolvedValue(room);

      const disconnectedRoom = await gameService.markPlayerDisconnected(
        'ROOM01',
        'p-bob',
      );
      const disconnectedBob = disconnectedRoom?.players.find(
        (player) => player.id === 'p-bob',
      );

      expect(disconnectedBob?.status).toBe(status);
      expect((disconnectedBob as any)?.connectionStatus).toBe('disconnected');

      storageService.getRoom.mockResolvedValue(disconnectedRoom);

      const reconnectedPlayer = await gameService.updatePlayerSocket(
        'ROOM01',
        'Bob',
        's-bob-new',
        'p-bob',
      );

      expect(reconnectedPlayer?.status).toBe(status);
      expect(reconnectedPlayer?.socketId).toBe('s-bob-new');
      expect((reconnectedPlayer as any)?.connectionStatus).toBe('connected');
      expect(storageService.persistRoom).toHaveBeenCalledTimes(2);
    },
  );

  it('reclaims left player record when joining with same name', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: '',
          name: 'Bob',
          position: 1,
          chips: 425,
          totalBuyIn: 1000,
          status: 'left',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player, rejoined } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-new-bob',
      'Bob',
      '🤠',
    );

    expect(rejoined).toBe(true);
    expect(player.id).toBe('p-bob');
    expect(player.socketId).toBe('s-new-bob');
    expect(player.status).toBe('waiting');
    expect(player.chips).toBe(425);
    expect(player.totalBuyIn).toBe(1000);
    expect((player as any).emoji).toBe('🤠');
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it('reclaims a left player by user id into the next open seat when the original seat is occupied', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      maxPlayers: 4,
      players: [
        {
          ...createPlayer({
            id: 'p-host',
            socketId: 's-host',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-alice',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-charlie',
            socketId: 's-charlie',
            name: 'Charlie',
            position: 1,
            chips: 1200,
            totalBuyIn: 1200,
            status: 'connected',
          }),
          userId: 'user-charlie',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-dana',
            socketId: 's-dana',
            name: 'Dana',
            position: 2,
            chips: 900,
            totalBuyIn: 900,
            status: 'connected',
          }),
          userId: 'user-dana',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-bob',
            socketId: '',
            name: 'Former Bob',
            position: 1,
            chips: 425,
            totalBuyIn: 1000,
            status: 'left',
          }),
          userId: 'user-bob',
        } as Player & { userId: string },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player, rejoined } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-new-bob',
      'Bob Returns',
      '🤠',
      'user-bob',
    );

    expect(rejoined).toBe(true);
    expect(player.id).toBe('p-bob');
    expect(player.position).toBe(3);
    expect(player.socketId).toBe('s-new-bob');
    expect(player.name).toBe('Bob Returns');
    expect(player.status).toBe('waiting');
    expect(player.chips).toBe(425);
  });

  it('allows the same authenticated user to take over an active seat from another device', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      players: [
        {
          ...createPlayer({
            id: 'p-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-alice',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-bob',
            socketId: 's-bob',
            name: 'Bob',
            position: 1,
            chips: 900,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-bob',
        } as Player & { userId: string },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player, rejoined } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-bob-new',
      'Bob',
      '🤠',
      'user-bob',
    );

    expect(rejoined).toBe(true);
    expect(player.id).toBe('p-bob');
    expect(player.socketId).toBe('s-bob-new');
    expect(player.status).toBe('connected');
    expect((player as any).connectionStatus).toBe('connected');
    expect(player.chips).toBe(900);
    expect((player as any).emoji).toBe('🤠');
    expect(storageService.persistRoom).toHaveBeenCalledWith(
      room,
      expect.anything(),
    );
  });

  it('rejects reconnecting a player seat owned by another authenticated user', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      players: [
        {
          ...createPlayer({
            id: 'p-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-alice',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-bob',
            socketId: 's-bob',
            name: 'Bob',
            position: 1,
            chips: 900,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-bob',
        } as Player & { userId: string },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const player = await gameService.updatePlayerSocket(
      'ROOM01',
      'Mallory',
      's-mallory',
      'p-bob',
      'user-mallory',
    );

    expect(player).toBeNull();
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('rejects reconnecting a robot or legacy seat without a matching authenticated user id', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      players: [
        {
          ...createPlayer({
            id: 'p-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-alice',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: 's-robot',
            name: 'Robot',
            position: 1,
            chips: 900,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          isRobot: true,
        } as Player,
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const player = await gameService.updatePlayerSocket(
      'ROOM01',
      'Mallory',
      's-mallory',
      'p-robot',
      'user-mallory',
    );

    expect(player).toBeNull();
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('rejects reclaiming a left player seat by name when it belongs to another authenticated user', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      maxPlayers: 4,
      players: [
        {
          ...createPlayer({
            id: 'p-alice',
            socketId: 's-alice',
            name: 'Alice',
            position: 0,
            chips: 1000,
            totalBuyIn: 1000,
            status: 'connected',
          }),
          userId: 'user-alice',
        } as Player & { userId: string },
        {
          ...createPlayer({
            id: 'p-bob',
            socketId: '',
            name: 'Bob',
            position: 1,
            chips: 900,
            totalBuyIn: 1000,
            status: 'left',
          }),
          userId: 'user-bob',
        } as Player & { userId: string },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addPlayerToRoom(
        'ROOM01',
        's-eve',
        'Bob',
        '😈',
        'user-eve',
      ),
    ).rejects.toThrow('Name already taken');
  });

  it('rejects left player reclaim when table is full and original seat is occupied', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      maxPlayers: 2,
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-charlie',
          socketId: 's-charlie',
          name: 'Charlie',
          position: 1,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: '',
          name: 'Bob',
          position: 1,
          chips: 425,
          totalBuyIn: 1000,
          status: 'left',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addPlayerToRoom('ROOM01', 's-new-bob', 'Bob'),
    ).rejects.toThrow('Room is full');
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('ignores left players for room capacity checks', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      maxPlayers: 2,
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
        createPlayer({
          id: 'p-left',
          socketId: '',
          name: 'Bob',
          position: 1,
          chips: 0,
          totalBuyIn: 0,
          status: 'left',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player } = await gameService.addPlayerToRoom(
      'ROOM01',
      's-charlie',
      'Charlie',
    );

    expect(player.name).toBe('Charlie');
    expect(player.position).toBe(1);
    expect(player.status).toBe('waiting');
    expect(room.players).toHaveLength(3);
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
  });

  it('rejects join when room is full', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      maxPlayers: 2,
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Alice',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 's-bob',
          name: 'Bob',
          position: 1,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addPlayerToRoom('ROOM01', 's-charlie', 'Charlie'),
    ).rejects.toThrow('Room is full');
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('marks player as left instead of removing player state', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      hostId: 'p-alice',
      players: [
        createPlayer({
          id: 'p-alice',
          socketId: 's-alice',
          name: 'Alice',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 's-bob',
          name: 'Bob',
          position: 1,
          chips: 850,
          totalBuyIn: 1000,
          status: 'connected',
        }),
      ],
      currentHand: {
        handNumber: 3,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-bob',
        pot: 30,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 20,
        lastRaiseSize: 10,
        activePlayers: ['p-alice', 'p-bob'],
        roundActions: { 'p-bob': true },
        sidePots: [],
        potContributions: {
          'p-bob': 20,
          'p-alice': 10,
        },
        vpipPlayerIds: [],
        startedAt: Date.now(),
      },
    });
    storageService.getRoom.mockResolvedValue(room);

    const updated = await gameService.removePlayerFromRoom('ROOM01', 'p-bob');

    expect(updated).not.toBeNull();
    const bob = room.players.find((player) => player.id === 'p-bob');
    expect(bob?.status).toBe('left');
    expect(bob?.socketId).toBe('');
    expect(updated?.players).toHaveLength(2);
    expect(updated?.hostId).toBe('p-alice');
    expect(updated?.currentHand?.activePlayers).toEqual(['p-alice']);
    expect(updated?.currentHand?.currentPlayerTurn).toBeNull();
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
    expect(storageService.persistRoom.mock.calls[0][1].events.map((event) => event.type)).toEqual([
      'PLAYER_LEFT',
    ]);
  });

  it('emits HOST_CHANGED only when the host actually changes', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-alice',
      players: [
        createPlayer({
          id: 'p-alice',
          socketId: 's-alice',
          name: 'Alice',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-bob',
          socketId: 's-bob',
          name: 'Bob',
          position: 1,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const updated = await gameService.removePlayerFromRoom('ROOM01', 'p-alice');

    expect(updated?.hostId).toBe('p-bob');
    expect(storageService.persistRoom.mock.calls[0][1].events.map((event) => event.type)).toEqual([
      'PLAYER_LEFT',
      'HOST_CHANGED',
    ]);
  });

  it('transfers host to the next seated human instead of a robot', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: '',
            name: 'Robot 1',
            position: 1,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          isRobot: true,
        },
        createPlayer({
          id: 'p-user',
          socketId: 's-user',
          name: 'User',
          position: 2,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const updated = await gameService.removePlayerFromRoom('ROOM01', 'p-host');

    expect(updated).not.toBeNull();
    expect(updated?.hostId).toBe('p-user');
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
    expect(storageService.deleteRoom).not.toHaveBeenCalled();
  });

  it('transfers a disconnected host to the next connected human after timeout flow', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        {
          ...createPlayer({
            id: 'p-host',
            socketId: '',
            name: 'Host',
            position: 0,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          connectionStatus: 'disconnected',
        },
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: '',
            name: 'Robot 1',
            position: 1,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          isRobot: true,
        },
        {
          ...createPlayer({
            id: 'p-user-disconnected',
            socketId: '',
            name: 'Offline User',
            position: 2,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          connectionStatus: 'disconnected',
        },
        createPlayer({
          id: 'p-user',
          socketId: 's-user',
          name: 'User',
          position: 3,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const updated = await gameService.transferHostOnDisconnectTimeout(
      'ROOM01',
      'p-host',
    );

    expect(updated).not.toBeNull();
    expect(updated?.hostId).toBe('p-user');
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
    expect(storageService.persistRoom.mock.calls[0][1].events.map((event) => event.type)).toEqual([
      'HOST_CHANGED',
    ]);
  });

  it('keeps host ownership unchanged when no connected human replacement exists after timeout flow', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        {
          ...createPlayer({
            id: 'p-host',
            socketId: '',
            name: 'Host',
            position: 0,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          connectionStatus: 'disconnected',
        },
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: '',
            name: 'Robot 1',
            position: 1,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          isRobot: true,
        },
        {
          ...createPlayer({
            id: 'p-user-disconnected',
            socketId: '',
            name: 'Offline User',
            position: 2,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          connectionStatus: 'disconnected',
        },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const updated = await gameService.transferHostOnDisconnectTimeout(
      'ROOM01',
      'p-host',
    );

    expect(updated).toBe(room);
    expect(updated?.hostId).toBe('p-host');
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('deletes the room when the last human leaves and only robots remain', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: '',
            name: 'Robot 1',
            position: 1,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          isRobot: true,
        },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const updated = await gameService.removePlayerFromRoom('ROOM01', 'p-host');

    expect(updated).toBeNull();
    expect(storageService.deleteRoom).toHaveBeenCalledWith('ROOM01');
    expect(storageService.persistRoom).not.toHaveBeenCalled();
  });

  it('allows host to add robot while game is waiting', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player } = await gameService.addRobotToRoom('ROOM01', 'p-host');

    expect(player.isRobot).toBe(true);
    expect(player.socketId).toBe('');
    expect(player.status).toBe('waiting');
    expect(player.name).toContain('Robot');
    expect(room.players).toHaveLength(2);
    expect(storageService.persistRoom).toHaveBeenCalledWith(room, expect.anything());
    expect(storageService.persistRoom.mock.calls[0][1].events.map((event) => event.type)).toEqual([
      'PLAYER_JOINED',
    ]);
  });

  it('rejects add robot for non-host player', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
        createPlayer({
          id: 'p-user',
          socketId: 's-user',
          name: 'User',
          position: 1,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addRobotToRoom('ROOM01', 'p-user'),
    ).rejects.toThrow('Only host can manage robots');
  });

  it('marks robot player as left when host removes it during waiting phase', async () => {
    const room = createRoom({
      gameState: 'WAITING',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 0,
          totalBuyIn: 0,
          status: 'waiting',
        }),
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: '',
            name: 'Robot 1',
            position: 1,
            chips: 0,
            totalBuyIn: 0,
            status: 'waiting',
          }),
          isRobot: true,
        },
      ],
    });
    storageService.getRoom.mockResolvedValue(room);

    const updatedRoom = await gameService.removeRobotFromRoom(
      'ROOM01',
      'p-host',
      'p-robot',
    );

    const robot = updatedRoom.players.find((player) => player.id === 'p-robot');
    expect(robot?.status).toBe('left');
    expect(storageService.persistRoom).toHaveBeenCalled();
    expect(storageService.persistRoom.mock.calls[0][1].events.map((event) => event.type)).toEqual([
      'PLAYER_LEFT',
    ]);
  });

  it('allows host to add robot between hands after result is shown', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 1200,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        createPlayer({
          id: 'p-user',
          socketId: 's-user',
          name: 'User',
          position: 1,
          chips: 800,
          totalBuyIn: 1000,
          status: 'connected',
        }),
      ],
      currentHand: {
        handNumber: 3,
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
        startedAt: Date.now(),
      },
    });
    storageService.getRoom.mockResolvedValue(room);

    const { player } = await gameService.addRobotToRoom('ROOM01', 'p-host');

    expect(player.isRobot).toBe(true);
    expect(player.name).toContain('Robot');
    expect(room.players).toHaveLength(3);
  });

  it('allows host to remove robot between hands after result is shown', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 1200,
          totalBuyIn: 1000,
          status: 'connected',
        }),
        {
          ...createPlayer({
            id: 'p-robot',
            socketId: '',
            name: 'Robot 1',
            position: 1,
            chips: 800,
            totalBuyIn: 1000,
            status: 'waiting',
          }),
          isRobot: true,
        },
      ],
      currentHand: {
        handNumber: 4,
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
        startedAt: Date.now(),
      },
    });
    storageService.getRoom.mockResolvedValue(room);

    const updatedRoom = await gameService.removeRobotFromRoom(
      'ROOM01',
      'p-host',
      'p-robot',
    );

    expect(
      updatedRoom.players.find((player) => player.id === 'p-robot')?.status,
    ).toBe('left');
  });

  it('rejects robot changes during an active hand', async () => {
    const room = createRoom({
      gameState: 'IN_PROGRESS',
      hostId: 'p-host',
      players: [
        createPlayer({
          id: 'p-host',
          socketId: 's-host',
          name: 'Host',
          position: 0,
          chips: 1000,
          totalBuyIn: 1000,
          status: 'connected',
        }),
      ],
      currentHand: {
        handNumber: 5,
        dealerPosition: 0,
        smallBlindPosition: 0,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p-host',
        pot: 20,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 20,
        lastRaiseSize: 10,
        activePlayers: ['p-host'],
        roundActions: {},
        sidePots: [],
        potContributions: { 'p-host': 20 },
        vpipPlayerIds: ['p-host'],
        startedAt: Date.now(),
      },
    });
    storageService.getRoom.mockResolvedValue(room);

    await expect(
      gameService.addRobotToRoom('ROOM01', 'p-host'),
    ).rejects.toThrow(
      'Robots can only be managed before game start or between hands',
    );
  });
});
