import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player } from 'poker-types';

describe('HandService run-count support', () => {
  let storageService: jest.Mocked<IStorageService>;
  let testDeckService: TestDeckService;
  let handService: HandService;
  const previousTestMode = process.env.TEST_MODE;

  beforeEach(() => {
    process.env.TEST_MODE = 'true';
    storageService = {
      saveRoom: jest.fn().mockResolvedValue(undefined),
      getRoom: jest.fn().mockResolvedValue(null),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
      getAllRooms: jest.fn().mockResolvedValue([]),
      roomExists: jest.fn().mockResolvedValue(false),
    };
    testDeckService = new TestDeckService();
    handService = new HandService(storageService, testDeckService);
  });

  afterAll(() => {
    if (previousTestMode === undefined) {
      delete process.env.TEST_MODE;
      return;
    }

    process.env.TEST_MODE = previousTestMode;
  });

  function createPlayer(params: {
    id: string;
    name: string;
    position: number;
    cards: Player['cards'];
    chips?: number;
    totalBuyIn?: number;
    status?: Player['status'];
  }): Player {
    return {
      id: params.id,
      socketId: `socket-${params.id}`,
      name: params.name,
      chips: params.chips ?? 0,
      totalBuyIn: params.totalBuyIn ?? 100,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position: params.position,
      status: params.status ?? 'connected',
      cards: params.cards,
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };
  }

  it('builds run-twice boards from the same remaining deck stub in order', async () => {
    const room: Room = {
      id: 'ROOM-RUN-COUNT',
      hostId: 'p1',
      config: {
        startingChips: 100,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 6,
        reconnectGracePeriod: 30000,
        allowPlayerStreetReveal: true,
      },
      players: [
        createPlayer({
          id: 'p1',
          name: 'Alice',
          position: 0,
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: '2' },
          ],
        }),
        createPlayer({
          id: 'p2',
          name: 'Bob',
          position: 1,
          cards: [
            { suit: 'spades', rank: 'K' },
            { suit: 'diamonds', rank: '3' },
          ],
        }),
      ],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 4,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: null,
        pot: 200,
        communityCards: [
          { suit: 'clubs', rank: '7' },
          { suit: 'diamonds', rank: '8' },
          { suit: 'hearts', rank: '9' },
        ],
        bettingRound: 'FLOP',
        currentBet: 0,
        lastRaiseSize: 10,
        activePlayers: ['p1', 'p2'],
        roundActions: {},
        sidePots: [],
        potContributions: {
          p1: 100,
          p2: 100,
        },
        runCountDecision: {
          eligiblePlayerIds: ['p1', 'p2'],
          twiceAgreedPlayerIds: [],
          expiresAt: Date.now() + 15000,
        },
        runCount: 1,
        runoutBoards: [],
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    testDeckService.setDeck(room.id, [
      { suit: 'spades', rank: '10' },
      { suit: 'clubs', rank: 'J' },
      { suit: 'hearts', rank: 'Q' },
      { suit: 'spades', rank: 'K' },
    ]);

    await handService.resolveRunCount(room, 2);

    expect(room.currentHand?.runCount).toBe(2);
    expect(room.currentHand?.communityCards).toEqual([
      { suit: 'clubs', rank: '7' },
      { suit: 'diamonds', rank: '8' },
      { suit: 'hearts', rank: '9' },
      { suit: 'spades', rank: '10' },
      { suit: 'clubs', rank: 'J' },
    ]);
    expect(room.currentHand?.runoutBoards).toEqual([
      [
        { suit: 'clubs', rank: '7' },
        { suit: 'diamonds', rank: '8' },
        { suit: 'hearts', rank: '9' },
        { suit: 'spades', rank: '10' },
        { suit: 'clubs', rank: 'J' },
      ],
      [
        { suit: 'clubs', rank: '7' },
        { suit: 'diamonds', rank: '8' },
        { suit: 'hearts', rank: '9' },
        { suit: 'hearts', rank: 'Q' },
        { suit: 'spades', rank: 'K' },
      ],
    ]);
    expect(testDeckService.getDeck(room.id)).toEqual([]);
  });

  it('splits aggregate payouts across two runouts while preserving chip conservation', async () => {
    const room: Room = {
      id: 'ROOM-RUN-RESULT',
      hostId: 'p1',
      config: {
        startingChips: 100,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 6,
        reconnectGracePeriod: 30000,
        allowPlayerStreetReveal: true,
      },
      players: [
        createPlayer({
          id: 'p1',
          name: 'Alice',
          position: 0,
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: '2' },
          ],
        }),
        createPlayer({
          id: 'p2',
          name: 'Bob',
          position: 1,
          cards: [
            { suit: 'spades', rank: 'K' },
            { suit: 'diamonds', rank: '3' },
          ],
        }),
      ],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 5,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: null,
        pot: 200,
        communityCards: [
          { suit: 'diamonds', rank: 'A' },
          { suit: 'clubs', rank: '7' },
          { suit: 'hearts', rank: '8' },
          { suit: 'spades', rank: '9' },
          { suit: 'clubs', rank: '10' },
        ],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 10,
        activePlayers: ['p1', 'p2'],
        roundActions: {},
        sidePots: [],
        potContributions: {
          p1: 100,
          p2: 100,
        },
        runCount: 2,
        runoutBoards: [
          [
            { suit: 'diamonds', rank: 'A' },
            { suit: 'clubs', rank: '7' },
            { suit: 'hearts', rank: '8' },
            { suit: 'spades', rank: '9' },
            { suit: 'clubs', rank: '10' },
          ],
          [
            { suit: 'diamonds', rank: 'K' },
            { suit: 'clubs', rank: '7' },
            { suit: 'hearts', rank: '8' },
            { suit: 'spades', rank: '9' },
            { suit: 'clubs', rank: '10' },
          ],
        ],
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const result = await handService.determineWinner(room);

    expect(result.runCount).toBe(2);
    expect(result.runouts).toHaveLength(2);
    expect(result.runouts?.[0].winners).toEqual([
      expect.objectContaining({
        playerId: 'p1',
        amountWon: 100,
      }),
    ]);
    expect(result.runouts?.[1].winners).toEqual([
      expect.objectContaining({
        playerId: 'p2',
        amountWon: 100,
      }),
    ]);
    expect(result.winners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'p1', amountWon: 100 }),
        expect.objectContaining({ playerId: 'p2', amountWon: 100 }),
      ]),
    );
    expect(result.netByPlayerId).toEqual({
      p1: 0,
      p2: 0,
    });
    expect(room.players.find((player) => player.id === 'p1')?.chips).toBe(100);
    expect(room.players.find((player) => player.id === 'p2')?.chips).toBe(100);
    expect(
      room.players.reduce((sum, player) => sum + player.chips, 0),
    ).toBe(200);
  });
});
