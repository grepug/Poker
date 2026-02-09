import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player } from 'poker-types';

describe('HandService chip conservation reconciliation', () => {
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

  function buildPlayer(params: {
    id: string;
    name: string;
    position: number;
    chips: number;
    totalBuyIn: number;
    status: Player['status'];
  }): Player {
    return {
      id: params.id,
      socketId: `socket-${params.id}`,
      name: params.name,
      chips: params.chips,
      totalBuyIn: params.totalBuyIn,
      position: params.position,
      status: params.status,
      cards: [
        { suit: 'hearts', rank: 'A' },
        { suit: 'spades', rank: 'K' },
      ],
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };
  }

  function buildSingleWinnerRoom(params: {
    pot: number;
    winnerChips: number;
    loserChips: number;
    winnerTotalBuyIn?: number;
    loserTotalBuyIn?: number;
  }): Room {
    const winner = buildPlayer({
      id: 'p1',
      name: 'Alice',
      position: 0,
      chips: params.winnerChips,
      totalBuyIn: params.winnerTotalBuyIn ?? 1000,
      status: 'connected',
    });
    const loser = buildPlayer({
      id: 'p2',
      name: 'Bob',
      position: 1,
      chips: params.loserChips,
      totalBuyIn: params.loserTotalBuyIn ?? 1000,
      status: 'folded',
    });

    return {
      id: 'ROOM-CONSERVE',
      hostId: winner.id,
      config: {
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        maxPlayers: 10,
        reconnectGracePeriod: 30000,
        allowPlayerHandReveal: true,
      },
      players: [winner, loser],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: winner.id,
        pot: params.pot,
        communityCards: [],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 20,
        activePlayers: [winner.id],
        roundActions: {},
        sidePots: [],
        potContributions: {
          [winner.id]: params.pot,
          [loser.id]: 0,
        },
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  it('credits small chip deficit to preferred winner and restores conservation', async () => {
    const room = buildSingleWinnerRoom({
      pot: 99,
      winnerChips: 900,
      loserChips: 1000,
    });

    await handService.determineWinner(room);

    const totalChips = room.players.reduce((sum, player) => sum + player.chips, 0);
    const expectedTotal = room.players.reduce(
      (sum, player) => sum + player.totalBuyIn,
      0,
    );
    const winner = room.players.find((player) => player.id === 'p1');

    expect(totalChips).toBe(expectedTotal);
    expect(winner?.chips).toBe(1000);
    expect(storageService.saveRoom).toHaveBeenCalled();
  });

  it('debits small chip surplus from winner-first order and restores conservation', async () => {
    const room = buildSingleWinnerRoom({
      pot: 0,
      winnerChips: 1001,
      loserChips: 1000,
    });

    await handService.determineWinner(room);

    const totalChips = room.players.reduce((sum, player) => sum + player.chips, 0);
    const expectedTotal = room.players.reduce(
      (sum, player) => sum + player.totalBuyIn,
      0,
    );
    const winner = room.players.find((player) => player.id === 'p1');
    const loser = room.players.find((player) => player.id === 'p2');

    expect(totalChips).toBe(expectedTotal);
    expect(winner?.chips).toBe(1000);
    expect(loser?.chips).toBe(1000);
    expect(storageService.saveRoom).toHaveBeenCalled();
  });
});
