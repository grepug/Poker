import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room } from 'poker-types';

describe('HandService side-pot distribution', () => {
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

  it('awards main pot and side pot to different eligible winners', async () => {
    const room: Room = {
      id: 'ROOM1',
      hostId: 'p1',
      config: {
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        maxPlayers: 10,
        reconnectGracePeriod: 30000,
      },
      players: [
        {
          id: 'p1',
          socketId: 's1',
          name: 'Alice',
          chips: 0,
          totalBuyIn: 1000,
          position: 0,
          status: 'all-in',
          cards: [
            { suit: 'spades', rank: 'A' },
            { suit: 'diamonds', rank: 'K' },
          ],
          currentBet: 0,
          lastAction: 'all-in',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p2',
          socketId: 's2',
          name: 'Bob',
          chips: 500,
          totalBuyIn: 2000,
          position: 1,
          status: 'connected',
          cards: [
            { suit: 'clubs', rank: 'Q' },
            { suit: 'clubs', rank: 'J' },
          ],
          currentBet: 0,
          lastAction: 'check',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p3',
          socketId: 's3',
          name: 'Charlie',
          chips: 500,
          totalBuyIn: 2000,
          position: 2,
          status: 'connected',
          cards: [
            { suit: 'diamonds', rank: '9' },
            { suit: 'diamonds', rank: '8' },
          ],
          currentBet: 0,
          lastAction: 'check',
          lastConnectedAt: Date.now(),
        },
      ],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 2,
        currentPlayerTurn: null,
        pot: 4000,
        communityCards: [
          { suit: 'hearts', rank: 'A' },
          { suit: 'clubs', rank: '2' },
          { suit: 'spades', rank: '5' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'clubs', rank: '10' },
        ],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 20,
        activePlayers: ['p1', 'p2', 'p3'],
        roundActions: {},
        sidePots: [],
        potContributions: {
          p1: 1000,
          p2: 1500,
          p3: 1500,
        },
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const result = await handService.determineWinner(room);

    const winnersByName = new Map(
      result.winners.map((winner) => [winner.playerName, winner.amountWon]),
    );

    expect(result.totalPot).toBe(4000);
    expect(winnersByName.get('Alice')).toBe(3000);
    expect(winnersByName.get('Bob')).toBe(1000);
    expect(winnersByName.get('Charlie') || 0).toBe(0);

    expect(room.players.find((p) => p.name === 'Alice')?.chips).toBe(3000);
    expect(room.players.find((p) => p.name === 'Bob')?.chips).toBe(1500);
    expect(room.players.find((p) => p.name === 'Charlie')?.chips).toBe(500);

    expect(storageService.saveRoom).toHaveBeenCalled();
  });
});
