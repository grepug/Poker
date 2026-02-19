import { EventsGateway } from '../../src/events/events.gateway';

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('EventsGateway showdown reveal/muck flow', () => {
  let gateway: EventsGateway;
  let gameService: any;
  let roomState: any;
  let storageService: any;
  let handService: any;
  let roomEmitter: { emit: jest.Mock };

  beforeEach(() => {
    roomState = {
      id: 'ROOM1',
      hostId: 'p-alice',
      config: {
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        maxPlayers: 9,
        reconnectGracePeriod: 120000,
        allowPlayerStreetReveal: true,
      },
      gameState: 'IN_PROGRESS',
      readyPhase: null,
      readyPlayerIds: [],
      players: [
        {
          id: 'p-alice',
          socketId: 'socket-alice',
          name: 'Alice',
          chips: 900,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'connected',
          cards: [
            { suit: 'hearts', rank: 'A' },
            { suit: 'clubs', rank: 'K' },
          ],
          currentBet: 0,
          lastAction: 'call',
          lastConnectedAt: Date.now(),
        },
        {
          id: 'p-bob',
          socketId: 'socket-bob',
          name: 'Bob',
          chips: 900,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 1,
          status: 'connected',
          cards: [
            { suit: 'spades', rank: 'Q' },
            { suit: 'diamonds', rank: 'J' },
          ],
          currentBet: 0,
          lastAction: 'call',
          lastConnectedAt: Date.now(),
        },
      ],
      currentHand: {
        handNumber: 7,
        dealerPosition: 0,
        smallBlindPosition: 1,
        bigBlindPosition: 0,
        bettingRound: 'SHOWDOWN',
        communityCards: [
          { suit: 'hearts', rank: '2' },
          { suit: 'diamonds', rank: '7' },
          { suit: 'clubs', rank: '9' },
          { suit: 'spades', rank: 'T' },
          { suit: 'hearts', rank: 'J' },
        ],
        pot: 200,
        currentBet: 0,
        currentPlayerTurn: null,
        activePlayers: ['p-alice', 'p-bob'],
        roundActions: {},
        sidePots: [],
        potContributions: {
          'p-alice': 100,
          'p-bob': 100,
        },
        pendingStreetRevealRound: null,
        nextStreetReadyPlayerIds: [],
        nextStreetRequiredPlayerIds: [],
        revealedPlayerIds: [],
        showdownDecisionOrder: [],
        showdownDecisionIndex: undefined,
        showdownDecisionPlayerId: null,
        showdownForcedRevealPlayerIds: [],
        showdownLastAggressorPlayerId: 'p-alice',
      },
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    gameService = {
      markPlayerDisconnected: jest.fn(async () => deepClone(roomState)),
    };

    storageService = {
      getRoom: jest.fn(async (roomId: string) => {
        if (roomId !== 'ROOM1') {
          return null;
        }
        return deepClone(roomState);
      }),
      saveRoom: jest.fn(async (room: any) => {
        roomState = deepClone(room);
      }),
      deleteRoom: jest.fn(),
      getAllRooms: jest.fn(),
      roomExists: jest.fn(),
    };

    handService = {
      advanceBettingRound: jest.fn(),
      determineWinner: jest.fn(async () => ({
        winners: [
          {
            playerId: 'p-bob',
            playerName: 'Bob',
            hand: {
              rank: 'pair',
              cards: [],
              kickers: [],
              description: 'Pair',
            },
            amountWon: 200,
          },
        ],
        playerHands: [
          {
            playerId: 'p-bob',
            playerName: 'Bob',
            cards: [
              { suit: 'spades', rank: 'Q' },
              { suit: 'diamonds', rank: 'J' },
            ],
            hand: {
              rank: 'pair',
              cards: [],
              kickers: [],
              description: 'Pair',
            },
          },
        ],
        totalPot: 200,
        payouts: [
          {
            segmentIndex: 0,
            potType: 'MAIN',
            amount: 200,
            eligiblePlayerIds: ['p-bob'],
            winnerShares: [
              {
                playerId: 'p-bob',
                amountWon: 200,
              },
            ],
            uncontested: true,
          },
        ],
        netByPlayerId: {
          'p-alice': -100,
          'p-bob': 100,
        },
      })),
      startNewHand: jest.fn(),
      getNextPlayer: jest.fn(),
    };

    roomEmitter = { emit: jest.fn() };

    gateway = new EventsGateway(
      gameService,
      handService,
      {
        calculateMinRaise: jest.fn().mockReturnValue(10),
      } as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      storageService,
      {
        getMessagePage: jest.fn().mockResolvedValue({
          messages: [],
          hasMore: false,
          nextBeforeSeq: null,
        }),
        appendMessage: jest.fn(),
        hasChatData: jest.fn(),
        deleteRoomChat: jest.fn(),
        listRoomsWithChatData: jest.fn(),
        pruneRoomMessages: jest.fn(),
      } as any,
      {
        saveVoiceClip: jest.fn(),
        deleteRoomMedia: jest.fn(),
        pruneOrphanMedia: jest.fn(),
      } as any,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      sockets: { sockets: new Map() },
    } as any;

    (gateway as any).socketToPlayer.set('socket-alice', {
      roomId: 'ROOM1',
      playerId: 'p-alice',
    });
    (gateway as any).socketToPlayer.set('socket-bob', {
      roomId: 'ROOM1',
      playerId: 'p-bob',
    });
  });

  it('keeps showdown pending after only one reveal', async () => {
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;

    const response = await gateway.handleShowMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(roomState.currentHand.revealedPlayerIds).toEqual(['p-alice']);
    expect(roomState.currentHand.showdownDecisionPlayerId).toBe('p-bob');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_REVEALED',
      expect.objectContaining({
        playerId: 'p-alice',
        cards: [
          { suit: 'hearts', rank: 'A' },
          { suit: 'clubs', rank: 'K' },
        ],
        showdownOrderIndex: 0,
      }),
    );
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(false);
  });

  it('rejects reveal when player is not current showdown decision player', async () => {
    const bobClient = { id: 'socket-bob', emit: jest.fn() } as any;

    const response = await gateway.handleShowMyHand(bobClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: false }));
    expect(handService.determineWinner).not.toHaveBeenCalled();
    expect(bobClient.emit).toHaveBeenCalledWith(
      'ERROR',
      expect.objectContaining({
        message: 'It is not your showdown decision turn',
      }),
    );
  });

  it('lets a player muck and immediately settles when one contender remains', async () => {
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;

    const response = await gateway.handleMuckMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
    const roomPassedToWinner = handService.determineWinner.mock.calls[0][0];
    expect(roomPassedToWinner.currentHand.activePlayers).toEqual(['p-bob']);
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_MUCKED',
      expect.objectContaining({ playerId: 'p-alice' }),
    );
    expect(
      roomEmitter.emit.mock.calls.some(
        ([eventName]) => eventName === 'HAND_COMPLETE',
      ),
    ).toBe(true);
  });

  it('auto-reveals forced all-in contender and settles hand', async () => {
    roomState.players = roomState.players.map((player: any) =>
      player.id === 'p-bob' ? { ...player, status: 'all-in' } : player,
    );
    const aliceClient = { id: 'socket-alice', emit: jest.fn() } as any;

    const response = await gateway.handleShowMyHand(aliceClient, {} as any);

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
    expect(
      roomEmitter.emit.mock.calls.filter(
        ([eventName]) => eventName === 'PLAYER_HAND_REVEALED',
      ),
    ).toEqual(
      expect.arrayContaining([
        [
          'PLAYER_HAND_REVEALED',
          expect.objectContaining({ playerId: 'p-alice', showdownOrderIndex: 0 }),
        ],
        [
          'PLAYER_HAND_REVEALED',
          expect.objectContaining({ playerId: 'p-bob', showdownOrderIndex: 1 }),
        ],
      ]),
    );
  });

  it('auto-mucks disconnected showdown decision player on disconnect timeout', async () => {
    roomState.players = roomState.players.map((player: any) =>
      player.id === 'p-alice' ? { ...player, status: 'disconnected' } : player,
    );
    roomState.currentHand.showdownDecisionOrder = ['p-alice', 'p-bob'];
    roomState.currentHand.showdownDecisionIndex = 0;
    roomState.currentHand.showdownDecisionPlayerId = 'p-alice';

    await (gateway as any).handleDisconnectTimeout('ROOM1', 'p-alice');

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'PLAYER_HAND_MUCKED',
      expect.objectContaining({ playerId: 'p-alice' }),
    );
    expect(handService.determineWinner).toHaveBeenCalledTimes(1);
  });
});
