import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player } from 'poker-types';

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

  function createPlayer(
    id: string,
    name: string,
    position: number,
    status: Player['status'],
  ): Player {
    return {
      id,
      socketId: `s-${id}`,
      name,
      chips: 0,
      totalBuyIn: 1000,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position,
      status,
      // Cards chosen so board always determines final hand rank.
      cards: [
        { suit: 'clubs', rank: '2' },
        { suit: 'diamonds', rank: '3' },
      ],
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };
  }

  function buildShowdownRoom(params: {
    contributions: Record<string, number>;
    activePlayerIds: string[];
    players: Array<{ id: string; name: string; position: number; status: Player['status'] }>;
  }): Room {
    const players = params.players.map((p) =>
      createPlayer(p.id, p.name, p.position, p.status),
    );
    const pot = Object.values(params.contributions).reduce(
      (sum, amount) => sum + amount,
      0,
    );

    return {
      id: 'ROOM-TIE',
      hostId: players[0].id,
      config: {
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        maxPlayers: 10,
        reconnectGracePeriod: 30000,
        allowPlayerStreetReveal: true,
      },
      players,
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 2,
        currentPlayerTurn: null,
        pot,
        // Mixed suits royal straight on board => all active players tie.
        communityCards: [
          { suit: 'clubs', rank: 'A' },
          { suit: 'diamonds', rank: 'K' },
          { suit: 'hearts', rank: 'Q' },
          { suit: 'spades', rank: 'J' },
          { suit: 'clubs', rank: '10' },
        ],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 20,
        activePlayers: params.activePlayerIds,
        roundActions: {},
        sidePots: [],
        potContributions: params.contributions,
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  function expectedTiePayoutByPlayerId(
    contributions: Record<string, number>,
    activePlayerIds: string[],
    positionsByPlayerId: Record<string, number>,
  ): Record<string, number> {
    const payouts: Record<string, number> = {};
    const entries = Object.entries(contributions).filter(([, amount]) => amount > 0);
    const levels = [...new Set(entries.map(([, amount]) => amount))].sort(
      (a, b) => a - b,
    );

    let previousLevel = 0;
    for (const level of levels) {
      const contributors = entries
        .filter(([, amount]) => amount >= level)
        .map(([playerId]) => playerId);
      const layerAmount = (level - previousLevel) * contributors.length;
      previousLevel = level;
      if (layerAmount <= 0) continue;

      const eligible = contributors.filter((playerId) =>
        activePlayerIds.includes(playerId),
      );
      if (eligible.length === 0) continue;

      eligible.sort(
        (a, b) => positionsByPlayerId[a] - positionsByPlayerId[b],
      );
      const amountPerWinner = Math.floor(layerAmount / eligible.length);
      const remainder = layerAmount % eligible.length;

      for (let i = 0; i < eligible.length; i++) {
        const award = amountPerWinner + (i < remainder ? 1 : 0);
        payouts[eligible[i]] = (payouts[eligible[i]] || 0) + award;
      }
    }

    return payouts;
  }

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
        allowPlayerStreetReveal: true,
      },
      players: [
        {
          id: 'p1',
          socketId: 's1',
          name: 'Alice',
          chips: 0,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
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
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
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
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
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
    expect(result.payouts).toHaveLength(2);
    expect(result.payouts[0]).toMatchObject({
      segmentIndex: 0,
      potType: 'MAIN',
      amount: 3000,
      eligiblePlayerIds: ['p1', 'p2', 'p3'],
      uncontested: false,
      winnerShares: [{ playerId: 'p1', amountWon: 3000 }],
    });
    expect(result.payouts[1]).toMatchObject({
      segmentIndex: 1,
      potType: 'SIDE',
      amount: 1000,
      eligiblePlayerIds: ['p2', 'p3'],
      uncontested: false,
      winnerShares: [{ playerId: 'p2', amountWon: 1000 }],
    });

    expect(room.players.find((p) => p.name === 'Alice')?.chips).toBe(3000);
    expect(room.players.find((p) => p.name === 'Bob')?.chips).toBe(1500);
    expect(room.players.find((p) => p.name === 'Charlie')?.chips).toBe(500);

    expect(storageService.saveRoom).toHaveBeenCalled();
  });

  it('marks uncontested side pot when only one active player is eligible', async () => {
    const room: Room = {
      id: 'ROOM-UNCONTESTED',
      hostId: 'p1',
      config: {
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        maxPlayers: 10,
        reconnectGracePeriod: 30000,
        allowPlayerStreetReveal: true,
      },
      players: [
        {
          id: 'p1',
          socketId: 's1',
          name: 'kai',
          chips: 0,
          totalBuyIn: 3000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'all-in',
          cards: [
            { suit: 'spades', rank: '8' },
            { suit: 'diamonds', rank: '10' },
          ],
          currentBet: 0,
          lastAction: 'all-in',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p2',
          socketId: 's2',
          name: 'Lisa',
          chips: 0,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 1,
          status: 'all-in',
          cards: [
            { suit: 'hearts', rank: '7' },
            { suit: 'clubs', rank: 'A' },
          ],
          currentBet: 0,
          lastAction: 'all-in',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p3',
          socketId: 's3',
          name: 'kkk',
          chips: 980,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 2,
          status: 'folded',
          cards: [
            { suit: 'clubs', rank: '4' },
            { suit: 'clubs', rank: '5' },
          ],
          currentBet: 0,
          lastAction: 'fold',
          lastConnectedAt: Date.now(),
        },
      ],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 5,
        dealerPosition: 2,
        smallBlindPosition: 0,
        bigBlindPosition: 1,
        currentPlayerTurn: null,
        pot: 4020,
        communityCards: [
          { suit: 'spades', rank: 'A' },
          { suit: 'diamonds', rank: '6' },
          { suit: 'spades', rank: '2' },
          { suit: 'spades', rank: '9' },
          { suit: 'spades', rank: '10' },
        ],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 20,
        activePlayers: ['p1', 'p2'],
        roundActions: {},
        sidePots: [],
        potContributions: {
          p1: 980,
          p2: 3020,
          p3: 20,
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

    expect(winnersByName.get('kai')).toBe(1980);
    expect(winnersByName.get('Lisa')).toBe(2040);
    expect(result.payouts).toHaveLength(3);

    expect(result.payouts[0]).toMatchObject({
      segmentIndex: 0,
      potType: 'MAIN',
      amount: 60,
      eligiblePlayerIds: ['p1', 'p2'],
      winnerShares: [{ playerId: 'p1', amountWon: 60 }],
      uncontested: false,
    });

    expect(result.payouts[1]).toMatchObject({
      segmentIndex: 1,
      potType: 'SIDE',
      amount: 1920,
      eligiblePlayerIds: ['p1', 'p2'],
      winnerShares: [{ playerId: 'p1', amountWon: 1920 }],
      uncontested: false,
    });

    expect(result.payouts[2]).toMatchObject({
      segmentIndex: 2,
      potType: 'SIDE',
      amount: 2040,
      eligiblePlayerIds: ['p2'],
      winnerShares: [{ playerId: 'p2', amountWon: 2040 }],
      uncontested: true,
    });
  });

  it('splits odd chips deterministically by position when tied on side pots', async () => {
    const room = buildShowdownRoom({
      contributions: { p1: 3, p2: 3, p3: 3 },
      activePlayerIds: ['p1', 'p2'],
      players: [
        { id: 'p1', name: 'Alice', position: 0, status: 'connected' },
        { id: 'p2', name: 'Bob', position: 1, status: 'connected' },
        { id: 'p3', name: 'Charlie', position: 2, status: 'folded' },
      ],
    });

    const result = await handService.determineWinner(room);
    const winnersByName = new Map(
      result.winners.map((winner) => [winner.playerName, winner.amountWon]),
    );

    // Pot=9 split between tied eligible players p1/p2 => 5/4 by position.
    expect(result.totalPot).toBe(9);
    expect(winnersByName.get('Alice')).toBe(5);
    expect(winnersByName.get('Bob')).toBe(4);
    expect(winnersByName.get('Charlie') || 0).toBe(0);
  });

  it('preserves payout invariants across randomized tied side-pot scenarios', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const playerCount = 3 + (seed % 3); // 3..5
      const players = Array.from({ length: playerCount }, (_, idx) => ({
        id: `p${idx + 1}`,
        name: `P${idx + 1}`,
        position: idx,
        status: 'connected' as const,
      }));

      const contributions: Record<string, number> = {};
      for (const p of players) {
        // Deterministic pseudo-random positive contributions (1..400)
        contributions[p.id] = ((seed * 37 + p.position * 53) % 400) + 1;
      }

      // Ensure at least two active players and one has max contribution so every
      // contribution layer has at least one eligible winner.
      const sortedByContribution = [...players].sort(
        (a, b) => contributions[b.id] - contributions[a.id],
      );
      const activePlayerIds = [sortedByContribution[0].id, sortedByContribution[1].id];

      // Randomly include extra active players.
      for (let i = 2; i < sortedByContribution.length; i++) {
        if (((seed + i) % 2) === 0) {
          activePlayerIds.push(sortedByContribution[i].id);
        }
      }

      const room = buildShowdownRoom({
        contributions,
        activePlayerIds,
        players: players.map((p) => ({
          ...p,
          status: activePlayerIds.includes(p.id) ? 'connected' : 'folded',
        })),
      });

      const expectedPayout = expectedTiePayoutByPlayerId(
        contributions,
        activePlayerIds,
        Object.fromEntries(players.map((p) => [p.id, p.position])),
      );
      const expectedTotal = Object.values(contributions).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      const expectedAwarded = Object.values(expectedPayout).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      expect(expectedAwarded).toBe(expectedTotal);

      const result = await handService.determineWinner(room);
      expect(result.totalPot).toBe(expectedTotal);

      const actualPayout = Object.fromEntries(
        result.winners.map((winner) => [winner.playerId, winner.amountWon]),
      );
      for (const playerId of activePlayerIds) {
        expect(actualPayout[playerId] || 0).toBe(expectedPayout[playerId] || 0);
      }
      for (const p of players.filter((player) => !activePlayerIds.includes(player.id))) {
        expect(actualPayout[p.id] || 0).toBe(0);
      }
    }
  });
});
