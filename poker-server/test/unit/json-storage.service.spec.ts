import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JsonStorageService } from '../../src/storage/json-storage.service';
import { Card, GameStateType, Room } from 'poker-types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { roomEvent, roomWrite } from '../../src/storage/room-write.factory';

describe('JsonStorageService', () => {
  let service: JsonStorageService;
  const testDataDir = path.join(__dirname, '..', '..', 'test-data');
  const testRoomsDir = path.join(testDataDir, 'rooms');

  beforeEach(async () => {
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }
    await fs.mkdir(testRoomsDir, { recursive: true });

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ DATA_DIR: testDataDir })],
        }),
      ],
      providers: [JsonStorageService],
    }).compile();

    service = module.get<JsonStorageService>(JsonStorageService);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore
    }
  });

  const createMockRoom = (id: string): Room => ({
    id,
    hostId: 'player1',
    config: {
      startingChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      maxPlayers: 6,
      reconnectGracePeriod: 30000,
      allowPlayerStreetReveal: true,
    },
    players: [],
    gameState: 'WAITING' as GameStateType,
    currentHand: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });

  const createCard = (rank: Card['rank'], suit: Card['suit']): Card => ({
    rank,
    suit,
  });

  const createRoomPlayer = (input: {
    id: string;
    name: string;
    position: number;
    chips: number;
    currentBet?: number;
    totalBuyIn?: number;
    cards?: Card[] | null;
  }) => ({
    id: input.id,
    socketId: `${input.id}-socket`,
    name: input.name,
    emoji: input.name === 'Alice' ? '🦊' : '🐻',
    chips: input.chips,
    totalBuyIn: input.totalBuyIn ?? 1000,
    handsPlayedCount: 0,
    handsWonCount: 0,
    vpipHandsCount: 0,
    position: input.position,
    status: 'connected' as const,
    cards: input.cards ?? null,
    currentBet: input.currentBet ?? 0,
    lastAction: null,
    lastConnectedAt: Date.now(),
  });

  const seedCompletedHands = async (roomId: string) => {
    const aliceCards = [createCard('A', 'hearts'), createCard('K', 'hearts')];
    const bobCards = [createCard('Q', 'spades'), createCard('J', 'clubs')];
    const flop = [
      createCard('2', 'clubs'),
      createCard('5', 'diamonds'),
      createCard('9', 'hearts'),
    ];
    const turn = createCard('K', 'diamonds');
    const river = createCard('7', 'spades');
    const room = createMockRoom(roomId);
    room.gameState = 'IN_PROGRESS';
    room.players = [
      createRoomPlayer({ id: 'alice', name: 'Alice', position: 0, chips: 980 }),
      createRoomPlayer({ id: 'bob', name: 'Bob', position: 1, chips: 980 }),
    ];

    room.lastActivityAt = 100;
    await service.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'HAND_STARTED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: 1,
          street: 'PRE_FLOP',
          payload: {
            handNumber: 1,
            dealerPosition: 0,
            smallBlindPosition: 0,
            bigBlindPosition: 1,
            pot: 30,
            currentBet: 20,
            lastRaiseSize: 20,
            currentPlayerTurn: 'alice',
            activePlayerIds: ['alice', 'bob'],
            dealtPlayerIds: ['alice', 'bob'],
            positionLabelsByPlayerId: {
              alice: 'BTN/SB',
              bob: 'BB',
            },
            potContributions: {
              alice: 10,
              bob: 20,
            },
            communityCards: [],
            players: [
              {
                playerId: 'alice',
                playerName: 'Alice',
                position: 0,
                status: 'connected',
                chips: 990,
                currentBet: 10,
                totalBuyIn: 1000,
                lastAction: null,
                isActiveInHand: true,
                positionLabel: 'BTN/SB',
                cards: aliceCards,
              },
              {
                playerId: 'bob',
                playerName: 'Bob',
                position: 1,
                status: 'connected',
                chips: 980,
                currentBet: 20,
                totalBuyIn: 1000,
                lastAction: null,
                isActiveInHand: true,
                positionLabel: 'BB',
                cards: bobCards,
              },
            ],
          },
        }),
      ),
    );

    room.lastActivityAt = 110;
    await service.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_ACTION',
          actor: {
            source: 'BETTING_SERVICE',
            playerId: 'alice',
            playerName: 'Alice',
          },
          handNumber: 1,
          street: 'PRE_FLOP',
          payload: {
            action: 'call',
            amount: null,
            playerStatus: 'connected',
            playerChips: 980,
            playerCurrentBet: 20,
            pot: 40,
            currentBet: 20,
            request: {
              action: 'call',
              actionId: 'hand-1-action-1',
            },
            decision: {
              currentPlayerTurnBefore: 'alice',
              playerStatusBefore: 'connected',
              playerChipsBefore: 990,
              playerCurrentBetBefore: 10,
              potBefore: 30,
              currentBetBefore: 20,
              lastRaiseSizeBefore: 20,
              callAmountBefore: 10,
              minimumRaiseBy: 20,
              minimumRaiseTo: 40,
              maximumBetTo: 1000,
              facingBet: true,
              legalActions: ['fold', 'call', 'raise', 'all-in'],
              activePlayerIds: ['alice', 'bob'],
              communityCards: [],
              potContributions: { alice: 10, bob: 20 },
              players: [],
            },
            result: {
              resolvedAction: 'call',
              displayKind: 'call-to',
              committedAmount: 10,
              totalBetAfterAction: 20,
              playerStatusAfter: 'connected',
              playerChipsAfter: 980,
              playerCurrentBetAfter: 20,
              potAfter: 40,
              currentBetAfter: 20,
              lastRaiseSizeAfter: 20,
              activePlayerIds: ['alice', 'bob'],
              potContributions: { alice: 20, bob: 20 },
              players: [],
            },
          },
        }),
        roomEvent({
          roomId,
          type: 'PLAYER_ACTION',
          actor: {
            source: 'BETTING_SERVICE',
            playerId: 'bob',
            playerName: 'Bob',
          },
          handNumber: 1,
          street: 'PRE_FLOP',
          payload: {
            action: 'check',
            amount: null,
            playerStatus: 'connected',
            playerChips: 980,
            playerCurrentBet: 20,
            pot: 40,
            currentBet: 20,
            request: {
              action: 'check',
              actionId: 'hand-1-action-2',
            },
            decision: {
              currentPlayerTurnBefore: 'bob',
              playerStatusBefore: 'connected',
              playerChipsBefore: 980,
              playerCurrentBetBefore: 20,
              potBefore: 40,
              currentBetBefore: 20,
              lastRaiseSizeBefore: 20,
              callAmountBefore: 0,
              minimumRaiseBy: 20,
              minimumRaiseTo: 40,
              maximumBetTo: 1000,
              facingBet: false,
              legalActions: ['check', 'raise', 'all-in'],
              activePlayerIds: ['alice', 'bob'],
              communityCards: [],
              potContributions: { alice: 20, bob: 20 },
              players: [],
            },
            result: {
              resolvedAction: 'check',
              displayKind: 'check',
              committedAmount: 0,
              totalBetAfterAction: 20,
              playerStatusAfter: 'connected',
              playerChipsAfter: 980,
              playerCurrentBetAfter: 20,
              potAfter: 40,
              currentBetAfter: 20,
              lastRaiseSizeAfter: 20,
              activePlayerIds: ['alice', 'bob'],
              potContributions: { alice: 20, bob: 20 },
              players: [],
            },
          },
        }),
      ),
    );

    room.lastActivityAt = 120;
    await service.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'BETTING_ROUND_ADVANCED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: 1,
          street: 'FLOP',
          payload: {
            nextRound: 'FLOP',
            communityCards: flop,
            currentPlayerTurn: 'bob',
            pot: 40,
            currentBet: 0,
            lastRaiseSize: 20,
            activePlayerIds: ['alice', 'bob'],
            potContributions: { alice: 20, bob: 20 },
            players: [],
          },
        }),
        roomEvent({
          roomId,
          type: 'BETTING_ROUND_ADVANCED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: 1,
          street: 'TURN',
          payload: {
            nextRound: 'TURN',
            communityCards: [...flop, turn],
            currentPlayerTurn: 'bob',
            pot: 40,
            currentBet: 0,
            lastRaiseSize: 20,
            activePlayerIds: ['alice', 'bob'],
            potContributions: { alice: 20, bob: 20 },
            players: [],
          },
        }),
        roomEvent({
          roomId,
          type: 'BETTING_ROUND_ADVANCED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: 1,
          street: 'RIVER',
          payload: {
            nextRound: 'RIVER',
            communityCards: [...flop, turn, river],
            currentPlayerTurn: 'bob',
            pot: 40,
            currentBet: 0,
            lastRaiseSize: 20,
            activePlayerIds: ['alice', 'bob'],
            potContributions: { alice: 20, bob: 20 },
            players: [],
          },
        }),
      ),
    );

    room.lastActivityAt = 130;
    await service.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'HAND_SETTLED',
          actor: { source: 'EVENTS_GATEWAY' },
          handNumber: 1,
          street: 'SHOWDOWN',
          payload: {
            handNumber: 1,
            isShowdown: true,
            revealedPlayerIds: ['alice'],
            result: {
              winners: [
                {
                  playerId: 'alice',
                  playerName: 'Alice',
                  hand: {
                    rank: 'ONE_PAIR',
                    value: 2,
                    cards: [
                      createCard('K', 'hearts'),
                      createCard('K', 'diamonds'),
                      createCard('A', 'hearts'),
                      createCard('9', 'hearts'),
                      createCard('7', 'spades'),
                    ],
                    description: 'Pair of Kings',
                  },
                  amountWon: 40,
                },
              ],
              playerHands: [
                {
                  playerId: 'alice',
                  playerName: 'Alice',
                  cards: aliceCards,
                  hand: {
                    rank: 'ONE_PAIR',
                    value: 2,
                    cards: [
                      createCard('K', 'hearts'),
                      createCard('K', 'diamonds'),
                      createCard('A', 'hearts'),
                      createCard('9', 'hearts'),
                      createCard('7', 'spades'),
                    ],
                    description: 'Pair of Kings',
                  },
                  resultStatus: 'shown',
                  cardsVisibility: 'shown',
                  seatPosition: 0,
                },
                {
                  playerId: 'bob',
                  playerName: 'Bob',
                  cards: [],
                  hand: null,
                  resultStatus: 'hidden_contender',
                  cardsVisibility: 'hidden',
                  seatPosition: 1,
                },
              ],
              totalPot: 40,
              payouts: [
                {
                  segmentIndex: 0,
                  potType: 'MAIN',
                  amount: 40,
                  eligiblePlayers: ['alice', 'bob'],
                  winnerShares: [{ playerId: 'alice', amountWon: 40 }],
                  uncontested: false,
                },
              ],
              netByPlayerId: {
                alice: 20,
                bob: -20,
              },
            },
          },
        }),
      ),
    );

    room.lastActivityAt = 200;
    await service.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'HAND_STARTED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: 2,
          street: 'PRE_FLOP',
          payload: {
            handNumber: 2,
            dealerPosition: 1,
            smallBlindPosition: 1,
            bigBlindPosition: 0,
            pot: 30,
            currentBet: 20,
            lastRaiseSize: 20,
            currentPlayerTurn: 'bob',
            activePlayerIds: ['alice', 'bob'],
            dealtPlayerIds: ['alice', 'bob'],
            positionLabelsByPlayerId: {
              alice: 'BB',
              bob: 'BTN/SB',
            },
            potContributions: {
              alice: 20,
              bob: 10,
            },
            communityCards: [],
            players: [
              {
                playerId: 'alice',
                playerName: 'Alice',
                position: 0,
                status: 'connected',
                chips: 980,
                currentBet: 20,
                totalBuyIn: 1000,
                lastAction: null,
                isActiveInHand: true,
                positionLabel: 'BB',
                cards: [createCard('9', 'clubs'), createCard('9', 'spades')],
              },
              {
                playerId: 'bob',
                playerName: 'Bob',
                position: 1,
                status: 'connected',
                chips: 990,
                currentBet: 10,
                totalBuyIn: 1000,
                lastAction: null,
                isActiveInHand: true,
                positionLabel: 'BTN/SB',
                cards: [createCard('4', 'hearts'), createCard('3', 'diamonds')],
              },
            ],
          },
        }),
      ),
    );

    room.lastActivityAt = 210;
    await service.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_ACTION',
          actor: {
            source: 'BETTING_SERVICE',
            playerId: 'bob',
            playerName: 'Bob',
          },
          handNumber: 2,
          street: 'PRE_FLOP',
          payload: {
            action: 'fold',
            amount: null,
            playerStatus: 'folded',
            playerChips: 990,
            playerCurrentBet: 10,
            pot: 30,
            currentBet: 20,
            request: {
              action: 'fold',
              actionId: 'hand-2-action-1',
            },
            decision: {
              currentPlayerTurnBefore: 'bob',
              playerStatusBefore: 'connected',
              playerChipsBefore: 990,
              playerCurrentBetBefore: 10,
              potBefore: 30,
              currentBetBefore: 20,
              lastRaiseSizeBefore: 20,
              callAmountBefore: 10,
              minimumRaiseBy: 20,
              minimumRaiseTo: 40,
              maximumBetTo: 1000,
              facingBet: true,
              legalActions: ['fold', 'call', 'raise', 'all-in'],
              activePlayerIds: ['alice', 'bob'],
              communityCards: [],
              potContributions: { alice: 20, bob: 10 },
              players: [],
            },
            result: {
              resolvedAction: 'fold',
              displayKind: 'fold',
              committedAmount: 0,
              totalBetAfterAction: 10,
              playerStatusAfter: 'folded',
              playerChipsAfter: 990,
              playerCurrentBetAfter: 10,
              potAfter: 30,
              currentBetAfter: 20,
              lastRaiseSizeAfter: 20,
              activePlayerIds: ['alice'],
              potContributions: { alice: 20, bob: 10 },
              players: [],
            },
          },
        }),
        roomEvent({
          roomId,
          type: 'HAND_SETTLED',
          actor: { source: 'EVENTS_GATEWAY' },
          handNumber: 2,
          street: 'PRE_FLOP',
          payload: {
            handNumber: 2,
            isShowdown: false,
            revealedPlayerIds: [],
            result: {
              winners: [
                {
                  playerId: 'alice',
                  playerName: 'Alice',
                  hand: null,
                  amountWon: 30,
                },
              ],
              playerHands: [
                {
                  playerId: 'alice',
                  playerName: 'Alice',
                  cards: [],
                  hand: null,
                  resultStatus: 'hidden_contender',
                  cardsVisibility: 'hidden',
                  seatPosition: 0,
                },
                {
                  playerId: 'bob',
                  playerName: 'Bob',
                  cards: [],
                  hand: null,
                  resultStatus: 'folded_pre_showdown',
                  cardsVisibility: 'hidden',
                  seatPosition: 1,
                },
              ],
              totalPot: 30,
              payouts: [
                {
                  segmentIndex: 0,
                  potType: 'MAIN',
                  amount: 30,
                  eligiblePlayers: ['alice', 'bob'],
                  winnerShares: [{ playerId: 'alice', amountWon: 30 }],
                  uncontested: true,
                },
              ],
              netByPlayerId: {
                alice: 10,
                bob: -10,
              },
            },
          },
        }),
      ),
    );

    room.gameState = 'ENDED';
    room.currentHand = null;
    room.lastActivityAt = 300;
    await service.persistRoom(room);
  };

  const seedPostLeaveHandLeakScenario = async (roomId: string) => {
    await seedCompletedHands(roomId);

    const handTwoPath = path.join(testRoomsDir, roomId, 'hands', '2.jsonl');
    const handTwoEvents = [
      {
        recordId: 'leave-hand-2-started',
        seq: 1,
        roomId,
        handNumber: 2,
        street: 'PRE_FLOP',
        timestamp: 200,
        type: 'HAND_STARTED',
        actor: { source: 'HAND_SERVICE' },
        payload: {
          handNumber: 2,
          dealerPosition: 1,
          smallBlindPosition: 1,
          bigBlindPosition: 2,
          pot: 30,
          currentBet: 20,
          lastRaiseSize: 20,
          currentPlayerTurn: 'bob',
          activePlayerIds: ['bob', 'charlie'],
          dealtPlayerIds: ['bob', 'charlie'],
          positionLabelsByPlayerId: {
            bob: 'BTN/SB',
            charlie: 'BB',
          },
          potContributions: {
            bob: 10,
            charlie: 20,
          },
          communityCards: [],
          players: [
            {
              playerId: 'bob',
              playerName: 'Bob',
              position: 1,
              status: 'connected',
              chips: 990,
              currentBet: 10,
              totalBuyIn: 1000,
              lastAction: null,
              isActiveInHand: true,
              positionLabel: 'BTN/SB',
              cards: [createCard('4', 'hearts'), createCard('3', 'diamonds')],
            },
            {
              playerId: 'charlie',
              playerName: 'Charlie',
              position: 2,
              status: 'connected',
              chips: 980,
              currentBet: 20,
              totalBuyIn: 1000,
              lastAction: null,
              isActiveInHand: true,
              positionLabel: 'BB',
              cards: [createCard('A', 'clubs'), createCard('Q', 'clubs')],
            },
          ],
        },
      },
      {
        recordId: 'leave-hand-2-action',
        seq: 2,
        roomId,
        handNumber: 2,
        street: 'PRE_FLOP',
        timestamp: 210,
        type: 'PLAYER_ACTION',
        actor: {
          source: 'BETTING_SERVICE',
          playerId: 'bob',
          playerName: 'Bob',
        },
        payload: {
          action: 'fold',
          amount: null,
          playerStatus: 'folded',
          playerChips: 990,
          playerCurrentBet: 10,
          pot: 30,
          currentBet: 20,
          request: {
            action: 'fold',
            actionId: 'leave-hand-2-action-1',
          },
          decision: {
            currentPlayerTurnBefore: 'bob',
            playerStatusBefore: 'connected',
            playerChipsBefore: 990,
            playerCurrentBetBefore: 10,
            potBefore: 30,
            currentBetBefore: 20,
            lastRaiseSizeBefore: 20,
            callAmountBefore: 10,
            minimumRaiseBy: 20,
            minimumRaiseTo: 40,
            maximumBetTo: 1000,
            facingBet: true,
            legalActions: ['fold', 'call', 'raise', 'all-in'],
            activePlayerIds: ['bob', 'charlie'],
            communityCards: [],
            potContributions: { bob: 10, charlie: 20 },
            players: [],
          },
          result: {
            resolvedAction: 'fold',
            displayKind: 'fold',
            committedAmount: 0,
            totalBetAfterAction: 10,
            playerStatusAfter: 'folded',
            playerChipsAfter: 990,
            playerCurrentBetAfter: 10,
            potAfter: 30,
            currentBetAfter: 20,
            lastRaiseSizeAfter: 20,
            activePlayerIds: ['charlie'],
            potContributions: { bob: 10, charlie: 20 },
            players: [],
          },
        },
      },
      {
        recordId: 'leave-hand-2-settled',
        seq: 3,
        roomId,
        handNumber: 2,
        street: 'PRE_FLOP',
        timestamp: 211,
        type: 'HAND_SETTLED',
        actor: { source: 'EVENTS_GATEWAY' },
        payload: {
          handNumber: 2,
          isShowdown: false,
          revealedPlayerIds: [],
          result: {
            winners: [
              {
                playerId: 'charlie',
                playerName: 'Charlie',
                hand: null,
                amountWon: 30,
              },
            ],
            playerHands: [
              {
                playerId: 'bob',
                playerName: 'Bob',
                cards: [],
                hand: null,
                resultStatus: 'folded_pre_showdown',
                cardsVisibility: 'hidden',
                seatPosition: 1,
              },
              {
                playerId: 'charlie',
                playerName: 'Charlie',
                cards: [],
                hand: null,
                resultStatus: 'hidden_contender',
                cardsVisibility: 'hidden',
                seatPosition: 2,
              },
            ],
            totalPot: 30,
            payouts: [
              {
                segmentIndex: 0,
                potType: 'MAIN',
                amount: 30,
                eligiblePlayers: ['bob', 'charlie'],
                winnerShares: [{ playerId: 'charlie', amountWon: 30 }],
                uncontested: true,
              },
            ],
            netByPlayerId: {
              bob: -10,
              charlie: 10,
            },
          },
        },
      },
    ];
    await fs.writeFile(
      handTwoPath,
      `${handTwoEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );

    const endedRoom = await service.getRoom(roomId);
    if (!endedRoom) {
      throw new Error('Expected ended room to exist');
    }

    const alice = endedRoom.players.find((player) => player.id === 'alice');
    const bob = endedRoom.players.find((player) => player.id === 'bob');
    if (!alice || !bob) {
      throw new Error('Expected seeded players to exist');
    }

    endedRoom.players = [
      {
        ...alice,
        userId: 'user-alice',
        status: 'left',
        socketId: '',
        cards: null,
        currentBet: 0,
        lastAction: null,
      },
      {
        ...bob,
        userId: 'user-bob',
      },
      {
        ...createRoomPlayer({
          id: 'charlie',
          name: 'Charlie',
          position: 2,
          chips: 1010,
          totalBuyIn: 1000,
        }),
        userId: 'user-charlie',
        emoji: '🐼',
      },
    ] as any;
    endedRoom.lastActivityAt = 320;
    await service.persistRoom(endedRoom);
  };

  describe('persistRoom', () => {
    it('should save room to room snapshot file', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const filePath = path.join(testRoomsDir, 'TEST123', 'room.snapshot.json');
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should save correct data', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const filePath = path.join(testRoomsDir, 'TEST123', 'room.snapshot.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(data);

      expect(saved.room.id).toBe('TEST123');
      expect(saved.room.hostId).toBe('player1');
      expect(saved.room.config.startingChips).toBe(1000);
      expect(saved.snapshot.lastRoomEventSeq).toBeGreaterThan(0);
    });

    it('should overwrite existing room', async () => {
      const room1 = createMockRoom('TEST123');
      room1.config.startingChips = 1000;

      const room2 = createMockRoom('TEST123');
      room2.config.startingChips = 2000;

      await service.persistRoom(room1);
      await service.persistRoom(room2);

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved?.config.startingChips).toBe(2000);
    });

    it('serializes concurrent writes per room with monotonic event sequences', async () => {
      await Promise.all(
        Array.from({ length: 8 }).map((_, index) =>
          service.persistRoom({
            ...createMockRoom('ROOMSEQ'),
            config: {
              ...createMockRoom('ROOMSEQ').config,
              startingChips: 1000 + index,
            },
            lastActivityAt: index + 1,
          }),
        ),
      );

      const raw = await fs.readFile(
        path.join(testRoomsDir, 'ROOMSEQ', 'room-events.jsonl'),
        'utf-8',
      );
      const seqs = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).seq);

      expect(seqs).toEqual(Array.from({ length: 8 }, (_, index) => index + 1));
    });

    it('rebuilds from the room log when the snapshot file is missing before the next write', async () => {
      const original = createMockRoom('ROOMLOG');
      original.config.startingChips = 1000;
      original.lastActivityAt = 100;

      await service.persistRoom(
        original,
        roomWrite(
          roomEvent({
            roomId: original.id,
            type: 'ROOM_CONFIG_UPDATED',
            actor: { source: 'ROOM_SERVICE' },
            payload: {
              startingChips: original.config.startingChips,
            },
          }),
        ),
      );

      await fs.rm(path.join(testRoomsDir, 'ROOMLOG', 'room.snapshot.json'));

      const updated = {
        ...original,
        config: {
          ...original.config,
          startingChips: 2000,
        },
        lastActivityAt: 200,
      };

      await service.persistRoom(
        updated,
        roomWrite(
          roomEvent({
            roomId: updated.id,
            type: 'ROOM_CONFIG_UPDATED',
            actor: { source: 'ROOM_SERVICE' },
            payload: {
              startingChips: updated.config.startingChips,
            },
          }),
        ),
      );

      const raw = await fs.readFile(
        path.join(testRoomsDir, 'ROOMLOG', 'room-events.jsonl'),
        'utf-8',
      );
      const records = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(records.map((record) => record.seq)).toEqual([1, 2, 3, 4]);
      expect(records[2].type).toBe('ROOM_CONFIG_UPDATED');
      expect((await service.getRoom('ROOMLOG'))?.config.startingChips).toBe(2000);
    });

    it('preserves additive robot decision metadata in persisted room events', async () => {
      const room = createMockRoom('ROOMROBOT');
      room.lastActivityAt = 321;

      await service.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'PLAYER_ACTION',
            actor: {
              source: 'BETTING_SERVICE',
              playerId: 'robot-1',
              playerName: 'Robot 1',
            },
            payload: {
              action: 'check',
              amount: null,
              playerStatus: 'connected',
              playerChips: 1000,
              playerCurrentBet: 0,
              pot: 15,
              currentBet: 10,
              request: {
                action: 'check',
                actionId: 'robot-action-1',
              },
              decision: {
                currentPlayerTurnBefore: 'robot-1',
                playerStatusBefore: 'connected',
                playerChipsBefore: 1000,
                playerCurrentBetBefore: 0,
                potBefore: 15,
                currentBetBefore: 10,
                lastRaiseSizeBefore: 10,
                callAmountBefore: 10,
                minimumRaiseBy: 10,
                minimumRaiseTo: 20,
                maximumBetTo: 1000,
                facingBet: true,
                legalActions: ['fold', 'call', 'raise', 'all-in'],
                activePlayerIds: ['robot-1', 'human-1'],
                communityCards: [],
                potContributions: { 'robot-1': 5, 'human-1': 10 },
                players: [],
              },
              result: {
                resolvedAction: 'check',
                displayKind: 'check',
                committedAmount: 0,
                totalBetAfterAction: 0,
                playerStatusAfter: 'connected',
                playerChipsAfter: 1000,
                playerCurrentBetAfter: 0,
                potAfter: 15,
                currentBetAfter: 10,
                lastRaiseSizeAfter: 10,
                activePlayerIds: ['robot-1', 'human-1'],
                potContributions: { 'robot-1': 5, 'human-1': 10 },
                players: [],
              },
              robotDecision: {
                source: 'deterministic-fallback',
                fallbackCause: 'provider-error',
                summary: 'Deterministic fallback check because provider error.',
                validationRetryCount: 0,
              },
            },
            handNumber: 1,
            street: 'PRE_FLOP',
          }),
        ),
      );

      const raw = await fs.readFile(
        path.join(testRoomsDir, 'ROOMROBOT', 'room-events.jsonl'),
        'utf-8',
      );
      const records = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const playerAction = records.find((record) => record.type === 'PLAYER_ACTION');

      expect(playerAction.payload.robotDecision).toEqual({
        source: 'deterministic-fallback',
        fallbackCause: 'provider-error',
        summary: 'Deterministic fallback check because provider error.',
        validationRetryCount: 0,
      });
      expect((await service.getRoom('ROOMROBOT'))?.id).toBe('ROOMROBOT');
    });

    it('removes a legacy room snapshot once the JSONL room layout is already usable', async () => {
      const room = createMockRoom('ROOMCLEAN');
      await fs.mkdir(path.join(testRoomsDir, 'ROOMCLEAN'), { recursive: true });
      await fs.writeFile(
        path.join(testRoomsDir, 'ROOMCLEAN.json'),
        JSON.stringify(room),
        'utf-8',
      );
      await fs.writeFile(
        path.join(testRoomsDir, 'ROOMCLEAN', 'room-events.jsonl'),
        [
          JSON.stringify({
            recordId: 'r1',
            seq: 1,
            roomId: 'ROOMCLEAN',
            handNumber: null,
            street: null,
            timestamp: room.createdAt,
            type: 'ROOM_MIGRATED',
            actor: { source: 'MIGRATION' },
            payload: { legacyPath: path.join(testRoomsDir, 'ROOMCLEAN.json') },
          }),
          JSON.stringify({
            recordId: 'r2',
            seq: 2,
            roomId: 'ROOMCLEAN',
            handNumber: null,
            street: null,
            timestamp: room.lastActivityAt,
            type: 'ROOM_STATE_UPDATED',
            actor: { source: 'SYSTEM' },
            payload: { room },
          }),
          '',
        ].join('\n'),
        'utf-8',
      );

      const loaded = await service.getRoom('ROOMCLEAN');
      expect(loaded?.id).toBe('ROOMCLEAN');
      await expect(fs.readFile(path.join(testRoomsDir, 'ROOMCLEAN.json'), 'utf-8')).rejects.toThrow();
    });

    it('rebuilds a corrupt room projection during legacy cleanup before removing the legacy file', async () => {
      const room = createMockRoom('ROOMCLEANBROKEN');
      await fs.mkdir(path.join(testRoomsDir, 'ROOMCLEANBROKEN'), { recursive: true });
      await fs.writeFile(
        path.join(testRoomsDir, 'ROOMCLEANBROKEN.json'),
        JSON.stringify(room),
        'utf-8',
      );
      await fs.writeFile(
        path.join(testRoomsDir, 'ROOMCLEANBROKEN', 'room-events.jsonl'),
        [
          JSON.stringify({
            recordId: 'r1',
            seq: 1,
            roomId: 'ROOMCLEANBROKEN',
            handNumber: null,
            street: null,
            timestamp: room.createdAt,
            type: 'ROOM_MIGRATED',
            actor: { source: 'MIGRATION' },
            payload: { legacyPath: path.join(testRoomsDir, 'ROOMCLEANBROKEN.json') },
          }),
          JSON.stringify({
            recordId: 'r2',
            seq: 2,
            roomId: 'ROOMCLEANBROKEN',
            handNumber: null,
            street: null,
            timestamp: room.lastActivityAt,
            type: 'ROOM_STATE_UPDATED',
            actor: { source: 'SYSTEM' },
            payload: { room },
          }),
          '',
        ].join('\n'),
        'utf-8',
      );
      await fs.writeFile(
        path.join(testRoomsDir, 'ROOMCLEANBROKEN', 'room.snapshot.json'),
        '{broken',
        'utf-8',
      );

      const loaded = await service.getRoom('ROOMCLEANBROKEN');
      expect(loaded?.id).toBe('ROOMCLEANBROKEN');
      await expect(
        fs.readFile(path.join(testRoomsDir, 'ROOMCLEANBROKEN.json'), 'utf-8'),
      ).rejects.toThrow();
    });
  });

  describe('getRoom', () => {
    it('should retrieve saved room', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('TEST123');
    });

    it('should return null for non-existent room', async () => {
      const retrieved = await service.getRoom('NONEXISTENT');
      expect(retrieved).toBeNull();
    });

    it('should parse room data correctly', async () => {
      const room = createMockRoom('TEST123');
      room.players = [
        {
          id: 'p1',
          socketId: 's1',
          name: 'Alice',
          chips: 1000,
          totalBuyIn: 1000,
          handsPlayedCount: 0,
          handsWonCount: 0,
          vpipHandsCount: 0,
          position: 0,
          status: 'waiting',
          cards: null,
          currentBet: 0,
          lastAction: null,
          lastConnectedAt: Date.now(),
        },
      ];

      await service.persistRoom(room);
      const retrieved = await service.getRoom('TEST123');

      expect(retrieved?.players).toHaveLength(1);
      expect(retrieved?.players[0].name).toBe('Alice');
    });
  });

  describe('deleteRoom', () => {
    it('should delete existing room', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      await service.deleteRoom('TEST123');

      const retrieved = await service.getRoom('TEST123');
      expect(retrieved).toBeNull();
    });

    it('should not throw error for non-existent room', async () => {
      await expect(service.deleteRoom('NONEXISTENT')).resolves.not.toThrow();
    });
  });

  describe('getAllRooms', () => {
    it('should return empty array when no rooms', async () => {
      const rooms = await service.getAllRooms();
      expect(rooms).toEqual([]);
    });

    it('should return all saved rooms', async () => {
      const room1 = createMockRoom('ROOM1');
      const room2 = createMockRoom('ROOM2');
      const room3 = createMockRoom('ROOM3');

      await service.persistRoom(room1);
      await service.persistRoom(room2);
      await service.persistRoom(room3);

      const rooms = await service.getAllRooms();
      expect(rooms).toHaveLength(3);

      const ids = rooms.map((r) => r.id).sort();
      expect(ids).toEqual(['ROOM1', 'ROOM2', 'ROOM3']);
    });

    it('should skip corrupted files', async () => {
      const room = createMockRoom('ROOM1');
      await service.persistRoom(room);

      // Create a corrupted file
      const corruptedDir = path.join(testRoomsDir, 'CORRUPTED');
      await fs.mkdir(corruptedDir, { recursive: true });
      const corruptedPath = path.join(corruptedDir, 'room.snapshot.json');
      await fs.writeFile(corruptedPath, 'invalid json {{{', 'utf-8');

      const rooms = await service.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('ROOM1');
    });

    it('should skip malformed legacy room snapshots during directory migration', async () => {
      const room = createMockRoom('ROOM1');
      await service.persistRoom(room);

      await fs.writeFile(
        path.join(testRoomsDir, 'BROKENLEGACY.json'),
        `${JSON.stringify(createMockRoom('BROKENLEGACY'))}4\n}`,
        'utf-8',
      );

      await expect(service.getAllRooms()).resolves.toEqual([
        expect.objectContaining({ id: 'ROOM1' }),
      ]);
    });
  });

  describe('roomExists', () => {
    it('should return true for existing room', async () => {
      const room = createMockRoom('TEST123');
      await service.persistRoom(room);

      const exists = await service.roomExists('TEST123');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent room', async () => {
      const exists = await service.roomExists('NONEXISTENT');
      expect(exists).toBe(false);
    });
  });

  describe('completed hand exports', () => {
    it('returns a player-scoped completed-hand export with deterministic blind and action ordering', async () => {
      await seedCompletedHands('ROOMHISTORY');

      const getCompletedHandHistory = (
        service as JsonStorageService & {
          getCompletedHandHistory?: (
            roomId: string,
            handNumber: number,
            requesterPlayerId: string,
          ) => Promise<any>;
        }
      ).getCompletedHandHistory;

      expect(typeof getCompletedHandHistory).toBe('function');
      if (typeof getCompletedHandHistory !== 'function') {
        return;
      }

      const aliceExport = await getCompletedHandHistory.call(
        service,
        'ROOMHISTORY',
        1,
        'alice',
      );
      const bobExport = await getCompletedHandHistory.call(
        service,
        'ROOMHISTORY',
        1,
        'bob',
      );

      expect(aliceExport).toEqual(
        expect.objectContaining({
          roomId: 'ROOMHISTORY',
          handNumber: 1,
          requesterPlayerId: 'alice',
          dealerPosition: 0,
          smallBlindPosition: 0,
          bigBlindPosition: 1,
          blinds: { smallBlind: 10, bigBlind: 20 },
          communityCardsByStreet: {
            preFlop: [],
            flop: [
              createCard('2', 'clubs'),
              createCard('5', 'diamonds'),
              createCard('9', 'hearts'),
            ],
            turn: [
              createCard('2', 'clubs'),
              createCard('5', 'diamonds'),
              createCard('9', 'hearts'),
              createCard('K', 'diamonds'),
            ],
            river: [
              createCard('2', 'clubs'),
              createCard('5', 'diamonds'),
              createCard('9', 'hearts'),
              createCard('K', 'diamonds'),
              createCard('7', 'spades'),
            ],
          },
          settlement: expect.objectContaining({
            isShowdown: true,
            totalPot: 40,
            netByPlayerId: { alice: 20, bob: -20 },
          }),
        }),
      );

      expect(
        aliceExport.actions
          .slice(0, 4)
          .map((action: any) => ({
            order: action.order,
            source: action.source,
            action: action.action,
            playerId: action.playerId,
            amount: action.amount,
            blindType: action.blindType ?? null,
            potAfter: action.potAfter,
            totalBetTo: action.totalBetTo ?? null,
          })),
      ).toEqual([
        {
          order: 1,
          source: 'blind',
          action: 'post-blind',
          playerId: 'alice',
          amount: 10,
          blindType: 'SB',
          potAfter: 10,
          totalBetTo: 10,
        },
        {
          order: 2,
          source: 'blind',
          action: 'post-blind',
          playerId: 'bob',
          amount: 20,
          blindType: 'BB',
          potAfter: 30,
          totalBetTo: 20,
        },
        {
          order: 3,
          source: 'player',
          action: 'call',
          playerId: 'alice',
          amount: 10,
          blindType: null,
          potAfter: 40,
          totalBetTo: 20,
        },
        {
          order: 4,
          source: 'player',
          action: 'check',
          playerId: 'bob',
          amount: 0,
          blindType: null,
          potAfter: 40,
          totalBetTo: 20,
        },
      ]);

      expect(
        aliceExport.seats.find((seat: any) => seat.playerId === 'alice'),
      ).toEqual(
        expect.objectContaining({
          playerId: 'alice',
          playerName: 'Alice',
          startingStack: 1000,
          holeCards: [createCard('A', 'hearts'), createCard('K', 'hearts')],
          holeCardsVisibility: 'self',
        }),
      );
      expect(
        aliceExport.seats.find((seat: any) => seat.playerId === 'bob'),
      ).toEqual(
        expect.objectContaining({
          playerId: 'bob',
          playerName: 'Bob',
          startingStack: 1000,
          holeCards: null,
          holeCardsVisibility: 'hidden',
        }),
      );
      expect(
        bobExport.seats.find((seat: any) => seat.playerId === 'alice'),
      ).toEqual(
        expect.objectContaining({
          playerId: 'alice',
          holeCards: [createCard('A', 'hearts'), createCard('K', 'hearts')],
          holeCardsVisibility: 'revealed',
        }),
      );
      expect(
        bobExport.seats.find((seat: any) => seat.playerId === 'bob'),
      ).toEqual(
        expect.objectContaining({
          playerId: 'bob',
          holeCards: [createCard('Q', 'spades'), createCard('J', 'clubs')],
          holeCardsVisibility: 'self',
        }),
      );
    });

    it('returns an ended-game export only after the room has ended and orders completed hands by hand number', async () => {
      const roomId = 'ROOMFULLGAME';
      await seedCompletedHands(roomId);

      const getCompletedGameHistory = (
        service as JsonStorageService & {
          getCompletedGameHistory?: (
            roomId: string,
            requesterPlayerId: string,
          ) => Promise<any>;
        }
      ).getCompletedGameHistory;

      expect(typeof getCompletedGameHistory).toBe('function');
      if (typeof getCompletedGameHistory !== 'function') {
        return;
      }

      const endedExport = await getCompletedGameHistory.call(
        service,
        roomId,
        'bob',
      );

      expect(endedExport).toEqual(
        expect.objectContaining({
          roomId,
          requesterPlayerId: 'bob',
          handCount: 2,
        }),
      );
      expect(endedExport.hands.map((hand: any) => hand.handNumber)).toEqual([
        1,
        2,
      ]);
      expect(endedExport.hands[0].requesterPlayerId).toBe('bob');
      expect(
        endedExport.hands[1].seats.find((seat: any) => seat.playerId === 'bob'),
      ).toEqual(
        expect.objectContaining({
          holeCards: [createCard('4', 'hearts'), createCard('3', 'diamonds')],
          holeCardsVisibility: 'self',
        }),
      );
      expect(
        endedExport.hands[1].seats.find((seat: any) => seat.playerId === 'alice'),
      ).toEqual(
        expect.objectContaining({
          holeCards: null,
          holeCardsVisibility: 'hidden',
        }),
      );
    });
  });

  describe('saved game archives', () => {
    it('archives an ended room for authenticated participants and keeps player-scoped history readable after room deletion', async () => {
      const roomId = 'ROOMARCHIVE1';
      await seedCompletedHands(roomId);

      const endedRoom = await service.getRoom(roomId);
      if (!endedRoom) {
        throw new Error('Expected ended room to exist');
      }

      endedRoom.players = endedRoom.players.map((player) => {
        if (player.id === 'alice') {
          return { ...player, userId: 'user-alice' };
        }
        if (player.id === 'bob') {
          return { ...player, userId: 'user-bob' };
        }
        return player;
      });
      endedRoom.lastActivityAt = 2500;
      await service.persistRoom(endedRoom);

      const archiveEndedRoom = (
        service as JsonStorageService & {
          archiveEndedRoom?: (roomId: string) => Promise<{ archiveId: string } | null>;
        }
      ).archiveEndedRoom;
      const listSavedGamesForUser = (
        service as JsonStorageService & {
          listSavedGamesForUser?: (userId: string) => Promise<any[]>;
        }
      ).listSavedGamesForUser;
      const getSavedGameDetailForUser = (
        service as JsonStorageService & {
          getSavedGameDetailForUser?: (
            archiveId: string,
            userId: string,
          ) => Promise<any | null>;
        }
      ).getSavedGameDetailForUser;
      const getSavedGameHandDetailForUser = (
        service as JsonStorageService & {
          getSavedGameHandDetailForUser?: (
            archiveId: string,
            userId: string,
            handNumber: number,
          ) => Promise<any | null>;
        }
      ).getSavedGameHandDetailForUser;

      expect(typeof archiveEndedRoom).toBe('function');
      expect(typeof listSavedGamesForUser).toBe('function');
      expect(typeof getSavedGameDetailForUser).toBe('function');
      expect(typeof getSavedGameHandDetailForUser).toBe('function');
      if (
        typeof archiveEndedRoom !== 'function' ||
        typeof listSavedGamesForUser !== 'function' ||
        typeof getSavedGameDetailForUser !== 'function' ||
        typeof getSavedGameHandDetailForUser !== 'function'
      ) {
        return;
      }

      const archived = await archiveEndedRoom.call(service, roomId);
      expect(archived).toEqual(
        expect.objectContaining({
          archiveId: expect.any(String),
        }),
      );

      const aliceGames = await listSavedGamesForUser.call(service, 'user-alice');
      expect(aliceGames).toEqual([
        expect.objectContaining({
          archiveId: archived?.archiveId,
          roomId,
          handCount: 2,
          requesterUserId: 'user-alice',
          requesterPlayerId: 'alice',
        }),
      ]);

      const aliceDetail = await getSavedGameDetailForUser.call(
        service,
        archived!.archiveId,
        'user-alice',
      );
      expect(aliceDetail).toEqual(
        expect.objectContaining({
          archiveId: archived?.archiveId,
          roomId,
          requesterUserId: 'user-alice',
          requesterPlayerId: 'alice',
          handCount: 2,
          hands: expect.arrayContaining([
            expect.objectContaining({
              handNumber: 1,
              totalPot: 40,
              actionCount: 4,
              analysis: expect.objectContaining({
                status: 'pending',
              }),
            }),
          ]),
        }),
      );

      const aliceHandDetail = await getSavedGameHandDetailForUser.call(
        service,
        archived!.archiveId,
        'user-alice',
        1,
      );
      expect(aliceHandDetail?.history.requesterPlayerId).toBe('alice');

      await service.deleteRoom(roomId);

      const archivedAfterDelete = await getSavedGameDetailForUser.call(
        service,
        archived!.archiveId,
        'user-alice',
      );
      expect(archivedAfterDelete?.hands[0]).toEqual(
        expect.objectContaining({
          handNumber: 1,
          totalPot: 40,
          actionCount: 4,
        }),
      );
      const archivedHandAfterDelete = await getSavedGameHandDetailForUser.call(
        service,
        archived!.archiveId,
        'user-alice',
        1,
      );
      expect(archivedHandAfterDelete?.history.requesterPlayerId).toBe('alice');
      expect(
        archivedHandAfterDelete?.history.seats.find(
          (seat: any) => seat.playerId === 'bob',
        ),
      ).toEqual(
        expect.objectContaining({
          holeCardsVisibility: 'hidden',
          holeCards: null,
        }),
      );

      const unauthorizedDetail = await getSavedGameDetailForUser.call(
        service,
        archived!.archiveId,
        'user-intruder',
      );
      expect(unauthorizedDetail).toBeNull();
    });

    it('excludes post-leave hands from saved-game ownership and review targets', async () => {
      const roomId = 'ROOMARCHIVE-LEFT-USER';
      await seedPostLeaveHandLeakScenario(roomId);

      const archiveEndedRoom = (
        service as JsonStorageService & {
          archiveEndedRoom?: (roomId: string) => Promise<{ archiveId: string } | null>;
        }
      ).archiveEndedRoom;
      const listSavedGamesForUser = (
        service as JsonStorageService & {
          listSavedGamesForUser?: (userId: string) => Promise<any[]>;
        }
      ).listSavedGamesForUser;
      const getSavedGameDetailForUser = (
        service as JsonStorageService & {
          getSavedGameDetailForUser?: (
            archiveId: string,
            userId: string,
          ) => Promise<any | null>;
        }
      ).getSavedGameDetailForUser;
      const getSavedGameHandDetailForUser = (
        service as JsonStorageService & {
          getSavedGameHandDetailForUser?: (
            archiveId: string,
            userId: string,
            handNumber: number,
          ) => Promise<any | null>;
        }
      ).getSavedGameHandDetailForUser;
      const getSavedGameReviewTargets = (
        service as JsonStorageService & {
          getSavedGameReviewTargets?: (archiveId: string) => Promise<any | null>;
        }
      ).getSavedGameReviewTargets;

      expect(typeof archiveEndedRoom).toBe('function');
      expect(typeof listSavedGamesForUser).toBe('function');
      expect(typeof getSavedGameDetailForUser).toBe('function');
      expect(typeof getSavedGameHandDetailForUser).toBe('function');
      expect(typeof getSavedGameReviewTargets).toBe('function');
      if (
        typeof archiveEndedRoom !== 'function' ||
        typeof listSavedGamesForUser !== 'function' ||
        typeof getSavedGameDetailForUser !== 'function' ||
        typeof getSavedGameHandDetailForUser !== 'function' ||
        typeof getSavedGameReviewTargets !== 'function'
      ) {
        return;
      }

      const archived = await archiveEndedRoom.call(service, roomId);
      const archiveId = archived?.archiveId;
      if (!archiveId) {
        throw new Error('Expected archive id');
      }

      const aliceGames = await listSavedGamesForUser.call(service, 'user-alice');
      expect(aliceGames).toEqual([
        expect.objectContaining({
          archiveId,
          requesterUserId: 'user-alice',
          requesterPlayerId: 'alice',
          handCount: 1,
        }),
      ]);

      const aliceDetail = await getSavedGameDetailForUser.call(
        service,
        archiveId,
        'user-alice',
      );
      expect(aliceDetail?.handCount).toBe(1);
      expect(aliceDetail?.hands.map((hand: any) => hand.handNumber)).toEqual([1]);

      const leakedHandDetail = await getSavedGameHandDetailForUser.call(
        service,
        archiveId,
        'user-alice',
        2,
      );
      expect(leakedHandDetail).toBeNull();

      const reviewTargets = await getSavedGameReviewTargets.call(service, archiveId);
      const aliceReviewTarget = reviewTargets?.playerViews.find(
        (view: any) => view.requesterUserId === 'user-alice',
      );
      expect(aliceReviewTarget?.hands.map((hand: any) => hand.handNumber)).toEqual([1]);
    });

    it('suppresses leaked post-leave hands from stale archive and user-index records', async () => {
      const roomId = 'ROOMARCHIVE-LEFT-USER-LEGACY';
      await seedPostLeaveHandLeakScenario(roomId);

      const archiveEndedRoom = (
        service as JsonStorageService & {
          archiveEndedRoom?: (roomId: string) => Promise<{ archiveId: string } | null>;
        }
      ).archiveEndedRoom;
      const listSavedGamesForUser = (
        service as JsonStorageService & {
          listSavedGamesForUser?: (userId: string) => Promise<any[]>;
        }
      ).listSavedGamesForUser;
      const getSavedGameDetailForUser = (
        service as JsonStorageService & {
          getSavedGameDetailForUser?: (
            archiveId: string,
            userId: string,
          ) => Promise<any | null>;
        }
      ).getSavedGameDetailForUser;
      const getSavedGameHandDetailForUser = (
        service as JsonStorageService & {
          getSavedGameHandDetailForUser?: (
            archiveId: string,
            userId: string,
            handNumber: number,
          ) => Promise<any | null>;
        }
      ).getSavedGameHandDetailForUser;
      const getSavedGameReviewTargets = (
        service as JsonStorageService & {
          getSavedGameReviewTargets?: (archiveId: string) => Promise<any | null>;
        }
      ).getSavedGameReviewTargets;

      expect(typeof archiveEndedRoom).toBe('function');
      expect(typeof listSavedGamesForUser).toBe('function');
      expect(typeof getSavedGameDetailForUser).toBe('function');
      expect(typeof getSavedGameHandDetailForUser).toBe('function');
      expect(typeof getSavedGameReviewTargets).toBe('function');
      if (
        typeof archiveEndedRoom !== 'function' ||
        typeof listSavedGamesForUser !== 'function' ||
        typeof getSavedGameDetailForUser !== 'function' ||
        typeof getSavedGameHandDetailForUser !== 'function' ||
        typeof getSavedGameReviewTargets !== 'function'
      ) {
        return;
      }

      const archived = await archiveEndedRoom.call(service, roomId);
      const archiveId = archived?.archiveId;
      if (!archiveId) {
        throw new Error('Expected archive id');
      }

      const archivePath = path.join(
        testDataDir,
        'saved-games',
        'archives',
        `${archiveId}.json`,
      );
      const userIndexPath = path.join(
        testDataDir,
        'saved-games',
        'users',
        'user-alice.json',
      );

      const archiveRecord = JSON.parse(
        await fs.readFile(archivePath, 'utf8'),
      ) as {
        handCount: number;
        playerViews: Record<string, { hands: any[] }>;
      };
      const leakedHand = archiveRecord.playerViews['user-bob'].hands.find(
        (hand) => hand.handNumber === 2,
      );
      if (!leakedHand) {
        throw new Error('Expected leaked hand source');
      }

      archiveRecord.handCount = 2;
      archiveRecord.playerViews['user-alice'].hands.push(leakedHand);
      await fs.writeFile(archivePath, JSON.stringify(archiveRecord, null, 2));

      const userIndex = JSON.parse(
        await fs.readFile(userIndexPath, 'utf8'),
      ) as Array<{ handCount: number }>;
      userIndex[0].handCount = 2;
      await fs.writeFile(userIndexPath, JSON.stringify(userIndex, null, 2));

      const aliceGames = await listSavedGamesForUser.call(service, 'user-alice');
      expect(aliceGames[0]?.handCount).toBe(1);

      const aliceDetail = await getSavedGameDetailForUser.call(
        service,
        archiveId,
        'user-alice',
      );
      expect(aliceDetail?.handCount).toBe(1);
      expect(aliceDetail?.hands.map((hand: any) => hand.handNumber)).toEqual([1]);

      const leakedHandDetail = await getSavedGameHandDetailForUser.call(
        service,
        archiveId,
        'user-alice',
        2,
      );
      expect(leakedHandDetail).toBeNull();

      const reviewTargets = await getSavedGameReviewTargets.call(service, archiveId);
      const aliceReviewTarget = reviewTargets?.playerViews.find(
        (view: any) => view.requesterUserId === 'user-alice',
      );
      expect(aliceReviewTarget?.hands.map((hand: any) => hand.handNumber)).toEqual([1]);
    });

    it('omits zero-activity left robots from archived saved-game participants', async () => {
      const roomId = 'ROOMARCHIVE-ROBOTS';
      await seedCompletedHands(roomId);

      const endedRoom = await service.getRoom(roomId);
      if (!endedRoom) {
        throw new Error('Expected ended room to exist');
      }

      endedRoom.players = endedRoom.players
        .map((player) => {
          if (player.id === 'alice') {
            return { ...player, userId: 'user-alice' };
          }
          if (player.id === 'bob') {
            return { ...player, userId: 'user-bob' };
          }
          return player;
        })
        .concat([
          {
            id: 'robot-idle',
            socketId: '',
            name: 'Robot 1',
            emoji: '🤖',
            isRobot: true,
            chips: 0,
            totalBuyIn: 0,
            handsPlayedCount: 0,
            handsWonCount: 0,
            vpipHandsCount: 0,
            position: 2,
            status: 'left' as const,
            cards: null,
            currentBet: 0,
            lastAction: null,
            lastConnectedAt: Date.now(),
          },
        ]);
      endedRoom.lastActivityAt = 2700;
      await service.persistRoom(endedRoom);

      const archiveEndedRoom = (
        service as JsonStorageService & {
          archiveEndedRoom?: (roomId: string) => Promise<{ archiveId: string } | null>;
        }
      ).archiveEndedRoom;
      const getSavedGameDetailForUser = (
        service as JsonStorageService & {
          getSavedGameDetailForUser?: (
            archiveId: string,
            userId: string,
          ) => Promise<any | null>;
        }
      ).getSavedGameDetailForUser;

      expect(typeof archiveEndedRoom).toBe('function');
      expect(typeof getSavedGameDetailForUser).toBe('function');
      if (
        typeof archiveEndedRoom !== 'function' ||
        typeof getSavedGameDetailForUser !== 'function'
      ) {
        return;
      }

      const archived = await archiveEndedRoom.call(service, roomId);
      const aliceDetail = await getSavedGameDetailForUser.call(
        service,
        archived!.archiveId,
        'user-alice',
      );

      expect(aliceDetail?.participants).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            playerId: 'robot-idle',
          }),
        ]),
      );
    });

    it('normalizes legacy zero-activity robots out of saved-game summary and detail reads', async () => {
      const roomId = 'ROOMARCHIVE-LEGACY-ROBOTS';
      await seedCompletedHands(roomId);

      const endedRoom = await service.getRoom(roomId);
      if (!endedRoom) {
        throw new Error('Expected ended room to exist');
      }

      endedRoom.players = endedRoom.players.map((player) => {
        if (player.id === 'alice') {
          return { ...player, userId: 'user-alice' };
        }
        if (player.id === 'bob') {
          return { ...player, userId: 'user-bob' };
        }
        return player;
      });
      endedRoom.lastActivityAt = 2800;
      await service.persistRoom(endedRoom);

      const archiveEndedRoom = (
        service as JsonStorageService & {
          archiveEndedRoom?: (roomId: string) => Promise<{ archiveId: string } | null>;
        }
      ).archiveEndedRoom;
      const listSavedGamesForUser = (
        service as JsonStorageService & {
          listSavedGamesForUser?: (userId: string) => Promise<any[]>;
        }
      ).listSavedGamesForUser;
      const getSavedGameDetailForUser = (
        service as JsonStorageService & {
          getSavedGameDetailForUser?: (
            archiveId: string,
            userId: string,
          ) => Promise<any | null>;
        }
      ).getSavedGameDetailForUser;

      expect(typeof archiveEndedRoom).toBe('function');
      expect(typeof listSavedGamesForUser).toBe('function');
      expect(typeof getSavedGameDetailForUser).toBe('function');
      if (
        typeof archiveEndedRoom !== 'function' ||
        typeof listSavedGamesForUser !== 'function' ||
        typeof getSavedGameDetailForUser !== 'function'
      ) {
        return;
      }

      const archived = await archiveEndedRoom.call(service, roomId);
      const archiveId = archived?.archiveId;
      if (!archiveId) {
        throw new Error('Expected archive id');
      }

      const legacyRobotParticipant = {
        playerId: 'robot-idle',
        userId: null,
        playerName: 'Robot 1',
        avatarEmoji: '🤖',
        isRobot: true,
        finalChips: 0,
        totalBuyIn: 0,
        profit: 0,
        handsPlayedCount: 0,
        handsWonCount: 0,
        vpipHandsCount: 0,
        vpipRate: 0,
      };
      const userIndexPath = path.join(
        testDataDir,
        'saved-games',
        'users',
        'user-alice.json',
      );
      const archivePath = path.join(
        testDataDir,
        'saved-games',
        'archives',
        `${archiveId}.json`,
      );
      const savedGames = JSON.parse(
        await fs.readFile(userIndexPath, 'utf8'),
      ) as Array<{ participants: unknown[] }>;
      savedGames[0].participants.push(legacyRobotParticipant);
      await fs.writeFile(userIndexPath, JSON.stringify(savedGames, null, 2));

      const archiveRecord = JSON.parse(
        await fs.readFile(archivePath, 'utf8'),
      ) as { participants: unknown[] };
      archiveRecord.participants.push(legacyRobotParticipant);
      await fs.writeFile(archivePath, JSON.stringify(archiveRecord, null, 2));

      const aliceGames = await listSavedGamesForUser.call(service, 'user-alice');
      expect(aliceGames[0]?.participants).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            playerId: 'robot-idle',
          }),
        ]),
      );
      expect(aliceGames[0]?.participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ playerId: 'alice' }),
          expect.objectContaining({ playerId: 'bob' }),
        ]),
      );

      const aliceDetail = await getSavedGameDetailForUser.call(
        service,
        archiveId,
        'user-alice',
      );
      expect(aliceDetail?.participants).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            playerId: 'robot-idle',
          }),
        ]),
      );
      expect(aliceDetail?.participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ playerId: 'alice' }),
          expect.objectContaining({ playerId: 'bob' }),
        ]),
      );
    });

    it('merges a localized locale entry without dropping other locales or changing canonical updatedAt', async () => {
      const roomId = 'ROOMARCHIVE2';
      await seedCompletedHands(roomId);

      const endedRoom = await service.getRoom(roomId);
      if (!endedRoom) {
        throw new Error('Expected ended room to exist');
      }

      endedRoom.players = endedRoom.players.map((player) => {
        if (player.id === 'alice') {
          return { ...player, userId: 'user-alice' };
        }
        if (player.id === 'bob') {
          return { ...player, userId: 'user-bob' };
        }
        return player;
      });
      endedRoom.lastActivityAt = 2600;
      await service.persistRoom(endedRoom);

      const archiveEndedRoom = (
        service as JsonStorageService & {
          archiveEndedRoom?: (roomId: string) => Promise<{ archiveId: string } | null>;
        }
      ).archiveEndedRoom;
      const updateSavedGameHandAnalysis = (
        service as JsonStorageService & {
          updateSavedGameHandAnalysis?: (
            archiveId: string,
            userId: string,
            handNumber: number,
            analysis: any,
          ) => Promise<void>;
        }
      ).updateSavedGameHandAnalysis;
      const mergeSavedGameHandLocalization = (
        service as JsonStorageService & {
          mergeSavedGameHandLocalization?: (
            archiveId: string,
            userId: string,
            handNumber: number,
            locale: string,
            entry: any,
          ) => Promise<boolean>;
        }
      ).mergeSavedGameHandLocalization;
      const getSavedGameDetailForUser = (
        service as JsonStorageService & {
          getSavedGameDetailForUser?: (
            archiveId: string,
            userId: string,
          ) => Promise<any | null>;
        }
      ).getSavedGameDetailForUser;

      expect(typeof archiveEndedRoom).toBe('function');
      expect(typeof updateSavedGameHandAnalysis).toBe('function');
      expect(typeof mergeSavedGameHandLocalization).toBe('function');
      expect(typeof getSavedGameDetailForUser).toBe('function');
      if (
        typeof archiveEndedRoom !== 'function' ||
        typeof updateSavedGameHandAnalysis !== 'function' ||
        typeof mergeSavedGameHandLocalization !== 'function' ||
        typeof getSavedGameDetailForUser !== 'function'
      ) {
        return;
      }

      const archived = await archiveEndedRoom.call(service, roomId);
      await updateSavedGameHandAnalysis.call(
        service,
        archived!.archiveId,
        'user-alice',
        1,
        {
          status: 'ready',
          updatedAt: 111,
          provider: 'ai-robot-config',
          headline: 'Canonical review',
          summary: 'Canonical summary',
          keyAdjustments: ['Canonical adjustment'],
          failureReason: null,
          localizedByLocale: {
            en: {
              status: 'ready',
              updatedAt: 111,
              headline: 'English review',
              summary: 'English summary',
              keyAdjustments: ['English adjustment'],
              failureReason: null,
            },
          },
        },
      );

      await mergeSavedGameHandLocalization.call(
        service,
        archived!.archiveId,
        'user-alice',
        1,
        'fr',
        {
          status: 'ready',
          updatedAt: 222,
          headline: 'Analyse francaise',
          summary: 'Resume francais',
          keyAdjustments: ['Ajustement francais'],
          failureReason: null,
        },
      );

      const detail = await getSavedGameDetailForUser.call(
        service,
        archived!.archiveId,
        'user-alice',
      );
      expect(detail?.hands[0].analysis.updatedAt).toBe(111);
      expect(detail?.hands[0].analysis.localizedByLocale).toEqual(
        expect.objectContaining({
          en: expect.objectContaining({
            headline: 'English review',
            updatedAt: 111,
          }),
          fr: expect.objectContaining({
            headline: 'Analyse francaise',
            updatedAt: 222,
          }),
        }),
      );
    });
  });
});
