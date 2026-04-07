import { BettingService } from '../../src/game/betting.service';

describe('BettingService robot action persistence', () => {
  let storageService: { persistRoom: jest.Mock };
  let service: BettingService;

  const createPlayer = (params: {
    id: string;
    name: string;
    position: number;
    isRobot?: boolean;
  }) => ({
    id: params.id,
    socketId: params.isRobot ? '' : `socket-${params.id}`,
    name: params.name,
    isRobot: params.isRobot ?? false,
    chips: 1000,
    totalBuyIn: 1000,
    handsPlayedCount: 0,
    handsWonCount: 0,
    vpipHandsCount: 0,
    position: params.position,
    status: 'active',
    cards: null,
    currentBet: 0,
    lastAction: null,
    lastConnectedAt: Date.now(),
  });

  const createRoom = (actor: ReturnType<typeof createPlayer>) => ({
    id: 'ROOM1',
    hostId: 'p-human',
    config: {
      startingChips: 1000,
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 10,
      reconnectGracePeriod: 120000,
      allowPlayerStreetReveal: true,
    },
    players: [
      actor,
      createPlayer({
        id: actor.id === 'p-human' ? 'p-villain' : 'p-human',
        name: actor.id === 'p-human' ? 'Villain' : 'Human',
        position: 1,
      }),
    ],
    gameState: 'IN_PROGRESS' as const,
    currentHand: {
      handNumber: 3,
      dealerPosition: 0,
      smallBlindPosition: 1,
      bigBlindPosition: 0,
      currentPlayerTurn: actor.id,
      pot: 15,
      communityCards: [],
      bettingRound: 'PRE_FLOP' as const,
      currentBet: 0,
      lastRaiseSize: 10,
      activePlayers: [
        actor.id,
        actor.id === 'p-human' ? 'p-villain' : 'p-human',
      ],
      roundActions: {},
      sidePots: [],
      potContributions: {},
      vpipPlayerIds: [],
      revealedPlayerIds: [],
    },
    readyPhase: null,
    readyPlayerIds: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });

  beforeEach(() => {
    storageService = {
      persistRoom: jest.fn().mockResolvedValue(undefined),
    };
    service = new BettingService(storageService as any);
  });

  it('persists provider-backed robot decision metadata on player actions', async () => {
    const robot = createPlayer({
      id: 'p-robot',
      name: 'Robot 1',
      position: 0,
      isRobot: true,
    });
    const room = createRoom(robot);

    await service.processAction(room as any, robot.id, 'check', undefined, {
      actionId: 'robot-1',
      robotDecision: {
        source: 'provider-output',
        summary: 'Provider final output accepted.',
        validationRetryCount: 0,
      },
    });

    expect(storageService.persistRoom).toHaveBeenCalledWith(
      room,
      expect.objectContaining({
        events: [
          expect.objectContaining({
            type: 'PLAYER_ACTION',
            payload: expect.objectContaining({
              robotDecision: {
                source: 'provider-output',
                summary: 'Provider final output accepted.',
                validationRetryCount: 0,
              },
            }),
          }),
        ],
      }),
    );
  });

  it('persists fallback robot decision metadata on player actions', async () => {
    const robot = createPlayer({
      id: 'p-robot',
      name: 'Robot 1',
      position: 0,
      isRobot: true,
    });
    const room = createRoom(robot);

    await service.processAction(room as any, robot.id, 'check', undefined, {
      actionId: 'robot-2',
      robotDecision: {
        source: 'deterministic-fallback',
        summary:
          'Deterministic fallback check because invalid final action after 2 validation retries.',
        validationRetryCount: 2,
        fallbackCause: 'invalid-final-action',
      },
    });

    expect(storageService.persistRoom).toHaveBeenCalledWith(
      room,
      expect.objectContaining({
        events: [
          expect.objectContaining({
            type: 'PLAYER_ACTION',
            payload: expect.objectContaining({
              robotDecision: {
                source: 'deterministic-fallback',
                summary:
                  'Deterministic fallback check because invalid final action after 2 validation retries.',
                validationRetryCount: 2,
                fallbackCause: 'invalid-final-action',
              },
            }),
          }),
        ],
      }),
    );
  });

  it('keeps human player action payloads free of robot decision metadata', async () => {
    const human = createPlayer({
      id: 'p-human',
      name: 'Human',
      position: 0,
    });
    const room = createRoom(human);

    await service.processAction(room as any, human.id, 'check', undefined, {
      actionId: 'human-1',
    });

    const persistCall = storageService.persistRoom.mock.calls[0]?.[1];
    expect(persistCall.events[0].payload).not.toHaveProperty('robotDecision');
  });
});
