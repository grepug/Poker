import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player } from 'poker-types';

describe('HandService turn order', () => {
  let storageService: jest.Mocked<IStorageService>;
  let handService: HandService;

  beforeEach(() => {
    storageService = {
      saveRoom: jest.fn().mockResolvedValue(undefined),
      getRoom: jest.fn().mockResolvedValue(null),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
      getAllRooms: jest.fn().mockResolvedValue([]),
      roomExists: jest.fn().mockResolvedValue(false),
    };

    handService = new HandService(storageService, new TestDeckService());
  });

  const buildPlayer = (params: {
    id: string;
    position: number;
    status?: Player['status'];
    chips?: number;
  }): Player => ({
    id: params.id,
    socketId: `socket-${params.id}`,
    name: params.id,
    chips: params.chips ?? 1000,
    totalBuyIn: 1000,
    handsPlayedCount: 0,
    handsWonCount: 0,
    vpipHandsCount: 0,
    position: params.position,
    status: params.status ?? 'connected',
    cards: null,
    currentBet: 0,
    lastAction: null,
    lastConnectedAt: Date.now(),
  });

  it('advances clockwise from folded actor position', () => {
    const playerAt7 = buildPlayer({ id: 'p7', position: 7, status: 'connected', chips: 500 });
    const foldedPlayerAt0 = buildPlayer({
      id: 'p0',
      position: 0,
      status: 'folded',
      chips: 500,
    });
    const playerAt3 = buildPlayer({ id: 'p3', position: 3, status: 'connected', chips: 500 });

    const room: Room = {
      id: 'ROOM-ORDER',
      hostId: 'p0',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      // Intentionally unsorted to match real join/rejoin order.
      players: [playerAt7, foldedPlayerAt0, playerAt3],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 1,
        dealerPosition: 7,
        smallBlindPosition: 0,
        bigBlindPosition: 3,
        currentPlayerTurn: 'p0',
        pot: 0,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 0,
        lastRaiseSize: 10,
        activePlayers: ['p7', 'p3'],
        roundActions: {},
        sidePots: [],
        potContributions: {},
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const nextPlayer = handService.getNextPlayer(room);
    expect(nextPlayer?.id).toBe('p3');
  });

  it('uses seat positions for heads-up blind assignment even when player array is unsorted', async () => {
    const room: Room = {
      id: 'ROOM-HEADSUP',
      hostId: 'p0',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      // Intentionally unsorted order to expose index-vs-seat bugs.
      players: [
        buildPlayer({ id: 'p3', position: 3 }),
        buildPlayer({ id: 'p0', position: 0 }),
      ],
      gameState: 'WAITING',
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const hand = await handService.startNewHand(room);

    expect(hand.dealerPosition).toBe(0);
    expect(hand.smallBlindPosition).toBe(3);
    expect(hand.bigBlindPosition).toBe(0);
    expect(hand.currentPlayerTurn).toBe('p3');

    const playerAt3 = room.players.find((player) => player.id === 'p3');
    const playerAt0 = room.players.find((player) => player.id === 'p0');
    expect(playerAt3?.chips).toBe(995);
    expect(playerAt0?.chips).toBe(990);
  });
});

