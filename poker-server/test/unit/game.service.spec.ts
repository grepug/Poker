import { GameService } from '../../src/game/game.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player, GameStateType } from 'poker-types';

describe('GameService addPlayerToRoom', () => {
  let storageService: jest.Mocked<IStorageService>;
  let gameService: GameService;

  beforeEach(() => {
    storageService = {
      saveRoom: jest.fn().mockResolvedValue(undefined),
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
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
    };
  }

  function createRoom(params: {
    gameState: GameStateType;
    players: Player[];
    maxPlayers?: number;
    startingChips?: number;
  }): Room {
    return {
      id: 'ROOM01',
      hostId: params.players[0]?.id ?? 'host-id',
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
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

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
    expect(storageService.saveRoom).toHaveBeenCalledWith(room);
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

    const { player } = await gameService.addPlayerToRoom('ROOM01', 's-charlie', 'Charlie');

    expect(player.name).toBe('Charlie');
    expect(player.status).toBe('waiting');
    expect(player.chips).toBe(1500);
    expect(player.totalBuyIn).toBe(1500);
    expect(room.players).toHaveLength(3);
    expect(storageService.saveRoom).toHaveBeenCalledWith(room);
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
    expect(storageService.saveRoom).not.toHaveBeenCalled();
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
    expect(storageService.saveRoom).not.toHaveBeenCalled();
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
    expect(storageService.saveRoom).toHaveBeenCalledWith(room);
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
    expect(storageService.saveRoom).not.toHaveBeenCalled();
  });
});
