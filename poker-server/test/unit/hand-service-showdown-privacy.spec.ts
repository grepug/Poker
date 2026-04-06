import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player } from 'poker-types';

describe('HandService showdown privacy', () => {
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
    cards: Player['cards'];
  }): Player {
    return {
      id: params.id,
      socketId: `socket-${params.id}`,
      name: params.name,
      chips: 900,
      totalBuyIn: 1000,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position: params.position,
      status: 'connected',
      cards: params.cards,
      currentBet: 0,
      lastAction: 'call',
      lastConnectedAt: Date.now(),
    };
  }

  it('redacts unrevealed showdown cards from hand results', async () => {
    const aliceCards: NonNullable<Player['cards']> = [
      { suit: 'hearts', rank: 'A' },
      { suit: 'spades', rank: 'K' },
    ];
    const bobCards: NonNullable<Player['cards']> = [
      { suit: 'clubs', rank: 'Q' },
      { suit: 'diamonds', rank: 'Q' },
    ];
    const alice = buildPlayer({
      id: 'p1',
      name: 'Alice',
      position: 0,
      cards: aliceCards,
    });
    const bob = buildPlayer({
      id: 'p2',
      name: 'Bob',
      position: 1,
      cards: bobCards,
    });

    const room: Room = {
      id: 'ROOM-PRIVACY',
      hostId: alice.id,
      config: {
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        maxPlayers: 10,
        reconnectGracePeriod: 30000,
        allowPlayerStreetReveal: true,
      },
      players: [alice, bob],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 12,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: null,
        pot: 200,
        communityCards: [
          { suit: 'hearts', rank: '2' },
          { suit: 'clubs', rank: '7' },
          { suit: 'spades', rank: '9' },
          { suit: 'diamonds', rank: 'J' },
          { suit: 'clubs', rank: 'K' },
        ],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 20,
        activePlayers: [alice.id, bob.id],
        roundActions: {},
        sidePots: [],
        potContributions: {
          [alice.id]: 100,
          [bob.id]: 100,
        },
        dealtPlayerIds: [alice.id, bob.id],
        revealedPlayerIds: [alice.id],
        showdownDecisionOrder: [alice.id, bob.id],
        startedAt: Date.now(),
      } as any,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const result = await handService.determineWinner(room);

    const aliceResult = result.playerHands.find((entry) => entry.playerId === alice.id);
    const bobResult = result.playerHands.find((entry) => entry.playerId === bob.id);

    expect(aliceResult).toMatchObject({
      playerId: alice.id,
      cardsVisibility: 'shown',
      cards: aliceCards,
      resultStatus: 'shown',
    });
    expect(bobResult).toMatchObject({
      playerId: bob.id,
      cardsVisibility: 'hidden',
      resultStatus: 'hidden_contender',
    });
    expect(bobResult?.cards).toEqual([]);
    expect(bobResult?.hand).toBeNull();
  });
});
