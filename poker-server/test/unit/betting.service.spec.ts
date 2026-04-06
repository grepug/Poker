import { BettingService } from '../../src/game/betting.service';
import { IStorageService } from '../../src/common/interfaces/storage.interface';
import { Player, Room } from 'poker-types';

describe('BettingService persistence context', () => {
  let storageService: jest.Mocked<IStorageService>;
  let bettingService: BettingService;

  beforeEach(() => {
    storageService = {
      persistRoom: jest.fn().mockResolvedValue(undefined),
      getRoom: jest.fn().mockResolvedValue(null),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
      getAllRooms: jest.fn().mockResolvedValue([]),
      roomExists: jest.fn().mockResolvedValue(false),
    };

    bettingService = new BettingService(storageService);
  });

  const buildPlayer = (params: {
    id: string;
    position: number;
    chips: number;
    currentBet?: number;
    status?: Player['status'];
  }): Player => ({
    id: params.id,
    socketId: `socket-${params.id}`,
    name: params.id,
    chips: params.chips,
    totalBuyIn: 1000,
    handsPlayedCount: 0,
    handsWonCount: 0,
    vpipHandsCount: 0,
    position: params.position,
    status: params.status ?? 'connected',
    cards: null,
    currentBet: params.currentBet ?? 0,
    lastAction: null,
    lastConnectedAt: Date.now(),
  });

  const buildRoom = (players: Player[]): Room => ({
    id: 'ROOM-ACTION',
    hostId: players[0].id,
    config: {
      startingChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      maxPlayers: 6,
      reconnectGracePeriod: 30000,
      allowPlayerStreetReveal: true,
    },
    players,
    gameState: 'IN_PROGRESS',
    currentHand: {
      handNumber: 3,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 1,
      currentPlayerTurn: players[0].id,
      pot: 30,
      communityCards: [],
      bettingRound: 'PRE_FLOP',
      currentBet: 20,
      lastRaiseSize: 20,
      activePlayers: players.map((player) => player.id),
      roundActions: {},
      sidePots: [],
      potContributions: {
        [players[0].id]: 10,
        [players[1].id]: 20,
      },
      positionLabelsByPlayerId: {
        [players[0].id]: 'SB',
        [players[1].id]: 'BB',
      },
      startedAt: Date.now(),
    },
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });

  it('persists explicit decision context for a raise action', async () => {
    const actingPlayer = buildPlayer({
      id: 'p1',
      position: 0,
      chips: 100,
      currentBet: 0,
    });
    const opponent = buildPlayer({
      id: 'p2',
      position: 1,
      chips: 100,
      currentBet: 20,
    });
    const room = buildRoom([actingPlayer, opponent]);

    await bettingService.processAction(room, 'p1', 'raise', 30, {
      actionId: 'action-1',
    });

    const persistedWrite = storageService.persistRoom.mock.calls[0][1];
    const payload = persistedWrite?.events[0].payload as any;

    expect(payload.request).toEqual({
      actionId: 'action-1',
      action: 'raise',
      amount: 30,
    });
    expect(payload.decision.callAmountBefore).toBe(20);
    expect(payload.decision.minimumRaiseBy).toBe(20);
    expect(payload.decision.minimumRaiseTo).toBe(40);
    expect(payload.decision.maximumBetTo).toBe(100);
    expect(payload.decision.facingBet).toBe(true);
    expect(payload.decision.legalActions).toEqual([
      'fold',
      'call',
      'raise',
      'all-in',
    ]);
    expect(payload.result.resolvedAction).toBe('raise');
    expect(payload.result.displayKind).toBe('raise-to');
    expect(payload.result.committedAmount).toBe(50);
    expect(payload.result.totalBetAfterAction).toBe(50);
    expect(payload.result.currentBetAfter).toBe(50);
    expect(payload.result.players.map((player: any) => player.playerId)).toEqual([
      'p1',
      'p2',
    ]);
  });

  it('persists requested raise separately when it resolves to all-in', async () => {
    const actingPlayer = buildPlayer({
      id: 'p1',
      position: 0,
      chips: 50,
      currentBet: 20,
    });
    const opponent = buildPlayer({
      id: 'p2',
      position: 1,
      chips: 100,
      currentBet: 40,
    });
    const room = buildRoom([actingPlayer, opponent]);
    room.currentHand!.pot = 60;
    room.currentHand!.currentBet = 40;
    room.currentHand!.potContributions = {
      p1: 20,
      p2: 40,
    };

    await bettingService.processAction(room, 'p1', 'raise', 40, {
      actionId: 'action-2',
    });

    const payload = storageService.persistRoom.mock.calls[0][1]?.events[0]
      .payload as any;

    expect(payload.request).toEqual({
      actionId: 'action-2',
      action: 'raise',
      amount: 40,
    });
    expect(payload.decision.callAmountBefore).toBe(20);
    expect(payload.result.resolvedAction).toBe('all-in');
    expect(payload.result.displayKind).toBe('all-in-to');
    expect(payload.result.committedAmount).toBe(50);
    expect(payload.result.totalBetAfterAction).toBe(70);
    expect(payload.result.playerStatusAfter).toBe('all-in');
    expect(payload.result.currentBetAfter).toBe(70);
  });
});
