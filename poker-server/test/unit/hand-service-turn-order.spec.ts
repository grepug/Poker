import { HandService } from '../../src/game/hand.service';
import { TestDeckService } from '../../src/game/test-deck.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Room, Player } from 'poker-types';

describe('HandService turn order', () => {
  let storageService: jest.Mocked<IStorageService>;
  let handService: HandService;

  beforeEach(() => {
    storageService = {
      persistRoom: jest.fn().mockResolvedValue(undefined),
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
    connectionStatus?: Player['connectionStatus'];
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
    connectionStatus: params.connectionStatus,
    cards: null,
    currentBet: 0,
    lastAction: null,
    lastConnectedAt: Date.now(),
  });

  it('advances clockwise from folded actor position', () => {
    const playerAt7 = buildPlayer({
      id: 'p7',
      position: 7,
      status: 'connected',
      chips: 500,
    });
    const foldedPlayerAt0 = buildPlayer({
      id: 'p0',
      position: 0,
      status: 'folded',
      chips: 500,
    });
    const playerAt3 = buildPlayer({
      id: 'p3',
      position: 3,
      status: 'connected',
      chips: 500,
    });

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

  it('uses seat positions for heads-up blind assignment even when displayed badges follow the UX contract', async () => {
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
    expect(hand.positionLabelsByPlayerId).toEqual({
      p0: 'BTN/SB',
      p3: 'BB',
    });

    const playerAt3 = room.players.find((player) => player.id === 'p3');
    const playerAt0 = room.players.find((player) => player.id === 'p0');
    expect(playerAt3?.chips).toBe(995);
    expect(playerAt0?.chips).toBe(990);

    const persistedWrite = storageService.persistRoom.mock.calls[0][1];
    const payload = persistedWrite?.events[0].payload as any;
    expect(payload.activePlayerIds).toEqual(['p0', 'p3']);
    expect(payload.positionLabelsByPlayerId).toEqual({
      p0: 'BTN/SB',
      p3: 'BB',
    });
    expect(payload.currentBet).toBe(10);
    expect(payload.lastRaiseSize).toBe(10);
    expect(payload.potContributions).toEqual({
      p0: 10,
      p3: 5,
    });
  });

  it('assigns multi-player position labels from the hand-start seat order', async () => {
    const room: Room = {
      id: 'ROOM-SIXMAX',
      hostId: 'p0',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [
        buildPlayer({ id: 'p8', position: 8 }),
        buildPlayer({ id: 'p0', position: 0 }),
        buildPlayer({ id: 'p4', position: 4 }),
        buildPlayer({ id: 'p9', position: 9 }),
        buildPlayer({ id: 'p2', position: 2 }),
        buildPlayer({ id: 'p6', position: 6 }),
      ],
      gameState: 'WAITING',
      currentHand: {
        handNumber: 7,
        dealerPosition: 4,
        smallBlindPosition: 6,
        bigBlindPosition: 8,
        currentPlayerTurn: null,
        pot: 0,
        communityCards: [],
        bettingRound: 'SHOWDOWN',
        currentBet: 0,
        lastRaiseSize: 10,
        activePlayers: [],
        roundActions: {},
        sidePots: [],
        potContributions: {},
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const hand = await handService.startNewHand(room);

    expect(hand.dealerPosition).toBe(6);
    expect(hand.smallBlindPosition).toBe(8);
    expect(hand.bigBlindPosition).toBe(9);
    expect(hand.positionLabelsByPlayerId).toEqual({
      p6: 'BTN',
      p8: 'SB',
      p9: 'BB',
      p0: 'UTG',
      p2: 'HJ',
      p4: 'CO',
    });
  });

  it('persists betting round advancement with table context', async () => {
    const room: Room = {
      id: 'ROOM-ADVANCE',
      hostId: 'p0',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [
        {
          ...buildPlayer({ id: 'p0', position: 0, chips: 990 }),
          currentBet: 0,
          cards: [
            { rank: 'A', suit: 'spades' },
            { rank: 'K', suit: 'spades' },
          ],
        },
        {
          ...buildPlayer({ id: 'p1', position: 1, chips: 995 }),
          currentBet: 0,
          cards: [
            { rank: 'Q', suit: 'hearts' },
            { rank: 'Q', suit: 'clubs' },
          ],
        },
      ],
      gameState: 'IN_PROGRESS',
      currentHand: {
        handNumber: 1,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        currentPlayerTurn: 'p1',
        pot: 15,
        communityCards: [],
        bettingRound: 'PRE_FLOP',
        currentBet: 10,
        lastRaiseSize: 10,
        activePlayers: ['p0', 'p1'],
        roundActions: { p0: true, p1: true },
        sidePots: [],
        potContributions: {
          p0: 10,
          p1: 5,
        },
        positionLabelsByPlayerId: {
          // Intentional heads-up UX contract: displayed badges stay BTN/SB for
          // the dealer and BB for the other player, even when blind mechanics
          // differ in the underlying hand state.
          p0: 'BTN/SB',
          p1: 'BB',
        },
        dealtPlayerIds: ['p0', 'p1'],
        startedAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const nextRound = await handService.advanceBettingRound(room);

    expect(nextRound).toBe('FLOP');
    const persistedWrite = storageService.persistRoom.mock.calls[0][1];
    const payload = persistedWrite?.events[0].payload as any;
    expect(payload.nextRound).toBe('FLOP');
    expect(payload.currentBet).toBe(0);
    expect(payload.lastRaiseSize).toBe(10);
    expect(payload.activePlayerIds).toEqual(['p0', 'p1']);
    expect(payload.potContributions).toEqual({
      p0: 10,
      p1: 5,
    });
    expect(payload.players.map((player: any) => player.playerId)).toEqual([
      'p0',
      'p1',
    ]);
    expect(payload.communityCards).toHaveLength(3);
  });

  it('assigns deterministic fallback position labels for tables above ten players', async () => {
    const room: Room = {
      id: 'ROOM-ELEVEN',
      hostId: 'p0',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 15,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [
        buildPlayer({ id: 'p8', position: 8 }),
        buildPlayer({ id: 'p0', position: 0 }),
        buildPlayer({ id: 'p4', position: 4 }),
        buildPlayer({ id: 'p9', position: 9 }),
        buildPlayer({ id: 'p2', position: 2 }),
        buildPlayer({ id: 'p6', position: 6 }),
        buildPlayer({ id: 'p1', position: 1 }),
        buildPlayer({ id: 'p3', position: 3 }),
        buildPlayer({ id: 'p5', position: 5 }),
        buildPlayer({ id: 'p7', position: 7 }),
        buildPlayer({ id: 'p10', position: 10 }),
      ],
      gameState: 'WAITING',
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const hand = await handService.startNewHand(room);

    expect(hand.positionLabelsByPlayerId).toMatchObject({
      p0: 'BTN',
      p1: 'SB',
      p2: 'BB',
      p3: 'UTG',
      p4: 'UTG+1',
      p5: 'UTG+2',
      p6: 'UTG+3',
      p7: 'MP',
      p8: 'LJ',
      p9: 'HJ',
      p10: 'CO',
    });
  });

  it('excludes disconnected seats from the next hand even when gameplay status stays connected', async () => {
    const room: Room = {
      id: 'ROOM-DISCONNECTED',
      hostId: 'p0',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 10,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      players: [
        buildPlayer({ id: 'p0', position: 0 }),
        buildPlayer({ id: 'p1', position: 1, connectionStatus: 'disconnected' }),
        buildPlayer({ id: 'p2', position: 2 }),
      ],
      gameState: 'WAITING',
      currentHand: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    const hand = await handService.startNewHand(room);

    expect(hand.activePlayers).toEqual(['p0', 'p2']);
    expect(hand.positionLabelsByPlayerId).toEqual({
      p0: 'BTN/SB',
      p2: 'BB',
    });
  });
});
