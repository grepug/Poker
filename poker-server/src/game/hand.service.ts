import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  Room,
  Hand,
  Player,
  BettingRound,
  HandResult,
  PotPayout,
  Card,
  RunCount,
  HandPositionLabel,
  PersistedBettingRoundAdvancedPayload,
  PersistedHandStartedPayload,
  PersistedRoomPlayerStateSnapshot,
} from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';
import { createDeck, shuffleDeck, dealCards } from '../common/utils/deck';
import { evaluateHand, compareHands } from '../common/utils/hand-evaluator';
import { TestDeckService } from './test-deck.service';
import { roomEvent, roomWrite } from '../storage/room-write.factory';

const POSITION_LABELS_BY_PLAYER_COUNT: Record<number, HandPositionLabel[]> = {
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
  10: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
};

const buildPositionLabels = (
  playerCount: number,
): HandPositionLabel[] | null => {
  const mappedLabels = POSITION_LABELS_BY_PLAYER_COUNT[playerCount];
  if (mappedLabels) {
    return mappedLabels;
  }

  if (playerCount < 3) {
    return null;
  }

  const earlyPositionCount = playerCount - 7;
  if (earlyPositionCount < 1) {
    return null;
  }

  const earlyPositionLabels = Array.from(
    { length: earlyPositionCount },
    (_, index) => (index === 0 ? 'UTG' : `UTG+${index}`) as HandPositionLabel,
  );

  return ['BTN', 'SB', 'BB', ...earlyPositionLabels, 'MP', 'LJ', 'HJ', 'CO'];
};

const isDisconnected = (player: Player): boolean =>
  player.connectionStatus === 'disconnected' ||
  player.status === 'disconnected';

@Injectable()
export class HandService {
  private readonly logger = new Logger(HandService.name);

  constructor(
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
    private readonly testDeckService: TestDeckService,
  ) {}

  /**
   * Start a new hand
   */
  async startNewHand(room: Room): Promise<Hand> {
    const useShortDeckRules = Boolean(room.config.useShortDeckRules);
    const seatedPlayers = room.players.filter(
      (player) => player.status !== 'left' && !isDisconnected(player),
    );
    if (seatedPlayers.length < 2) {
      throw new Error('Need at least 2 players to start a hand');
    }

    // Auto-refill busted players with starting chips and track it as an added buy-in.
    for (const player of seatedPlayers) {
      if (player.chips === 0) {
        player.chips = room.config.startingChips;
        player.totalBuyIn =
          (player.totalBuyIn ?? 0) + room.config.startingChips;
      }
    }

    const handNumber = room.currentHand ? room.currentHand.handNumber + 1 : 1;

    // Determine positions
    const activePlayers = this.getPlayersInSeatOrder(
      room.players.filter(
        (p) => p.chips > 0 && p.status !== 'left' && !isDisconnected(p),
      ),
    );
    const dealerPosition = this.getNextDealerPosition(room, activePlayers);
    const activePlayerIds = activePlayers.map((p) => p.id);
    const playerCount = activePlayers.length;

    if (playerCount < 2) {
      throw new Error('Need at least 2 players with chips');
    }

    const smallBlindPlayer = this.getNextPlayerByPosition(
      activePlayers,
      dealerPosition,
    );
    const bigBlindPlayer = smallBlindPlayer
      ? this.getNextPlayerByPosition(activePlayers, smallBlindPlayer.position)
      : null;
    if (!smallBlindPlayer || !bigBlindPlayer) {
      throw new Error('Unable to resolve blind players');
    }
    const smallBlindPosition = smallBlindPlayer.position;
    const bigBlindPosition = bigBlindPlayer.position;

    const sbAmount = Math.min(room.config.smallBlind, smallBlindPlayer.chips);
    const bbAmount = Math.min(room.config.bigBlind, bigBlindPlayer.chips);

    smallBlindPlayer.chips -= sbAmount;
    smallBlindPlayer.currentBet = sbAmount;

    bigBlindPlayer.chips -= bbAmount;
    bigBlindPlayer.currentBet = bbAmount;

    const pot = sbAmount + bbAmount;
    const potContributions: Record<string, number> = Object.fromEntries(
      activePlayerIds.map((id) => [id, 0]),
    );
    potContributions[smallBlindPlayer.id] += sbAmount;
    potContributions[bigBlindPlayer.id] += bbAmount;

    // Deal cards - use test deck if available
    let deck: Card[];
    const testDeck = this.testDeckService.getDeck(room.id);

    if (testDeck) {
      this.logger.debug(`Using test deck for room ${room.id}`);
      deck = testDeck;
    } else {
      deck = shuffleDeck(createDeck({ useShortDeckRules }));
    }

    for (const player of activePlayers) {
      player.handsPlayedCount = (player.handsPlayedCount ?? 0) + 1;
      const { dealt, remaining } = dealCards(deck, 2);
      player.cards = dealt;
      player.status = 'connected';
      deck = remaining;
    }

    // Save remaining deck back to test service if in test mode
    if (testDeck) {
      this.testDeckService.setDeck(room.id, deck);
    }

    // First to act pre-flop:
    // - Heads-up: small blind (who is the button/dealer) acts first
    // - 3+ players: player left of big blind acts first
    const firstToActPlayer =
      playerCount === 2
        ? smallBlindPlayer
        : this.getNextPlayerByPosition(activePlayers, bigBlindPosition);
    if (!firstToActPlayer) {
      throw new Error('Unable to resolve first player to act');
    }
    const currentPlayerTurn = firstToActPlayer.id;

    const hand: Hand = {
      handNumber,
      dealerPosition,
      smallBlindPosition,
      bigBlindPosition,
      currentPlayerTurn,
      pot,
      communityCards: [],
      bettingRound: 'PRE_FLOP',
      currentBet: bbAmount,
      lastRaiseSize: room.config.bigBlind, // Initial raise size is the big blind
      activePlayers: activePlayerIds,
      roundActions: {},
      sidePots: [],
      potContributions,
      dealtPlayerIds: [...activePlayerIds],
      positionLabelsByPlayerId: this.buildPositionLabelsByPlayerId({
        activePlayers,
        dealerPosition,
        smallBlindPosition,
        bigBlindPosition,
      }),
      vpipPlayerIds: [],
      showdownLastAggressorPlayerId: null,
      runCountDecision: null,
      runCount: 1,
      runoutBoards: [],
      startedAt: Date.now(),
    };

    room.currentHand = hand;
    room.gameState = 'IN_PROGRESS';
    room.readyPhase = null;
    room.readyPlayerIds = [];
    room.lastActivityAt = Date.now();

    const handStartedPayload: PersistedHandStartedPayload = {
      handNumber: hand.handNumber,
      dealerPosition,
      smallBlindPosition,
      bigBlindPosition,
      pot,
      currentBet: hand.currentBet,
      lastRaiseSize: hand.lastRaiseSize,
      currentPlayerTurn,
      activePlayerIds: [...hand.activePlayers],
      dealtPlayerIds: [...(hand.dealtPlayerIds ?? [])],
      positionLabelsByPlayerId: { ...(hand.positionLabelsByPlayerId ?? {}) },
      potContributions: { ...hand.potContributions },
      communityCards: [...hand.communityCards],
      players: this.buildPersistedPlayerSnapshots(room, { includeCards: true }),
    };

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'HAND_STARTED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: hand.handNumber,
          street: hand.bettingRound,
          payload: handStartedPayload,
        }),
      ),
    );
    this.logger.log(`Hand #${handNumber} started in room ${room.id}`);

    return hand;
  }

  /**
   * Advance to next betting round
   */
  async advanceBettingRound(room: Room): Promise<BettingRound> {
    const useShortDeckRules = Boolean(room.config.useShortDeckRules);
    const hand = room.currentHand;
    if (!hand) {
      throw new Error('No active hand');
    }

    this.logger.debug(
      `[advanceBettingRound] Current round: ${hand.bettingRound}, community cards: ${hand.communityCards.length}`,
    );

    // Check if all remaining active players are all-in (≤1 player can still bet)
    const playersWhoCanBet = room.players.filter(
      (p) =>
        hand.activePlayers.includes(p.id) &&
        p.status !== 'folded' &&
        p.status !== 'all-in' &&
        p.status !== 'left' &&
        p.chips > 0,
    );

    this.logger.debug(
      `[advanceBettingRound] Players who can bet: ${playersWhoCanBet.length} (${playersWhoCanBet.map((p) => p.name).join(', ')})`,
    );

    const allPlayersAllIn = playersWhoCanBet.length <= 1;

    // Get deck - use test deck if available, otherwise create and shuffle
    let deck: Card[];
    const testDeck = this.testDeckService.getDeck(room.id);

    if (testDeck) {
      this.logger.debug(`Using test deck for room ${room.id}`);
      deck = testDeck;
    } else {
      deck = shuffleDeck(createDeck({ useShortDeckRules }));

      // Remove already dealt cards (only needed for random decks)
      const dealtCards = [
        ...hand.communityCards,
        ...room.players.flatMap((p) => p.cards || []),
      ];

      deck = deck.filter(
        (card) =>
          !dealtCards.some(
            (dealt) => dealt.suit === card.suit && dealt.rank === card.rank,
          ),
      );
    }

    // If everyone is all-in, deal all remaining cards and go straight to showdown
    if (allPlayersAllIn && hand.bettingRound !== 'SHOWDOWN') {
      this.logger.debug(
        `[advanceBettingRound] All players all-in, dealing remaining cards. Current: ${hand.communityCards.length} cards`,
      );
      while (hand.communityCards.length < 5) {
        const { dealt, remaining } = dealCards(deck, 1);
        hand.communityCards.push(dealt[0]);
        deck = remaining;
        this.logger.debug(
          `[advanceBettingRound] Dealt ${dealt[0].rank}${dealt[0].suit}, total: ${hand.communityCards.length}`,
        );
      }
      hand.bettingRound = 'SHOWDOWN';
      hand.runCount = 1;
      hand.runoutBoards = [[...hand.communityCards]];

      // Update test deck if in test mode
      if (testDeck) {
        this.testDeckService.setDeck(room.id, deck);
      }

      room.lastActivityAt = Date.now();
      const showdownAdvancePayload: PersistedBettingRoundAdvancedPayload = {
        nextRound: 'SHOWDOWN',
        communityCards: [...hand.communityCards],
        currentPlayerTurn: hand.currentPlayerTurn,
        allPlayersAllIn: true,
        pot: hand.pot,
        currentBet: hand.currentBet,
        lastRaiseSize: hand.lastRaiseSize,
        activePlayerIds: [...hand.activePlayers],
        potContributions: { ...hand.potContributions },
        players: this.buildPersistedPlayerSnapshots(room, {
          includeCards: true,
        }),
      };
      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'BETTING_ROUND_ADVANCED',
            actor: { source: 'HAND_SERVICE' },
            handNumber: hand.handNumber,
            street: 'SHOWDOWN',
            payload: showdownAdvancePayload,
          }),
        ),
      );
      this.logger.log(
        `All players all-in, skipping to showdown in room ${room.id}, community cards: ${hand.communityCards.length}`,
      );
      return 'SHOWDOWN';
    }

    switch (hand.bettingRound) {
      case 'PRE_FLOP':
        // Deal 3 cards (flop)
        const { dealt: flop, remaining: afterFlop } = dealCards(deck, 3);
        hand.communityCards = flop;
        hand.bettingRound = 'FLOP';
        deck = afterFlop;
        break;

      case 'FLOP':
        // Deal 1 card (turn)
        const { dealt: turn, remaining: afterTurn } = dealCards(deck, 1);
        hand.communityCards.push(turn[0]);
        hand.bettingRound = 'TURN';
        deck = afterTurn;
        break;

      case 'TURN':
        // Deal 1 card (river)
        const { dealt: river, remaining: afterRiver } = dealCards(deck, 1);
        hand.communityCards.push(river[0]);
        hand.bettingRound = 'RIVER';
        deck = afterRiver;
        break;

      case 'RIVER':
        hand.bettingRound = 'SHOWDOWN';
        hand.runCount = 1;
        hand.runoutBoards = [[...hand.communityCards]];
        break;

      case 'SHOWDOWN':
        throw new Error('Already at showdown');
    }

    // Update test deck if in test mode
    if (testDeck) {
      this.testDeckService.setDeck(room.id, deck);
    }

    // Reset betting for new round
    hand.currentBet = 0;
    hand.lastRaiseSize = room.config.bigBlind; // Reset to big blind for new round
    hand.roundActions = {};
    if (hand.bettingRound !== 'SHOWDOWN') {
      hand.showdownLastAggressorPlayerId = null;
    }

    for (const player of room.players) {
      player.currentBet = 0;
    }

    // Set first to act (first active player after dealer)
    const activePlayers = this.getActivePlayers(room);
    const nextPlayer = this.getNextPlayerByPosition(
      activePlayers,
      hand.dealerPosition,
    );
    if (nextPlayer) {
      hand.currentPlayerTurn = nextPlayer.id;
    }

    room.lastActivityAt = Date.now();
    const roundAdvancePayload: PersistedBettingRoundAdvancedPayload = {
      nextRound: hand.bettingRound,
      communityCards: [...hand.communityCards],
      currentPlayerTurn: hand.currentPlayerTurn,
      pot: hand.pot,
      currentBet: hand.currentBet,
      lastRaiseSize: hand.lastRaiseSize,
      activePlayerIds: [...hand.activePlayers],
      potContributions: { ...hand.potContributions },
      players: this.buildPersistedPlayerSnapshots(room, {
        includeCards: true,
      }),
    };
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'BETTING_ROUND_ADVANCED',
          actor: { source: 'HAND_SERVICE' },
          handNumber: hand.handNumber,
          street: hand.bettingRound,
          payload: roundAdvancePayload,
        }),
      ),
    );

    this.logger.log(`Advanced to ${hand.bettingRound} in room ${room.id}`);
    return hand.bettingRound;
  }

  async resolveRunCount(room: Room, runCount: RunCount): Promise<BettingRound> {
    const hand = room.currentHand;
    if (!hand) {
      throw new Error('No active hand');
    }

    const prefixBoard = [...hand.communityCards];
    const runoutBoards = this.buildRunoutBoards(room, runCount, prefixBoard);
    hand.communityCards = [...(runoutBoards[0] ?? prefixBoard)];
    hand.runCount = runCount;
    hand.runoutBoards = runoutBoards;
    hand.runCountDecision = null;
    hand.bettingRound = 'SHOWDOWN';
    hand.currentPlayerTurn = null;

    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(room);

    this.logger.log(
      `Resolved run count=${runCount} for room ${room.id}, boards=${runoutBoards.length}`,
    );
    return 'SHOWDOWN';
  }

  private buildRunoutBoards(
    room: Room,
    runCount: RunCount,
    prefixBoard: Card[],
  ): Card[][] {
    if (prefixBoard.length >= 5) {
      return [[...prefixBoard]];
    }

    const { deck: initialDeck, persistDeck } = this.buildRemainingDeck(room);
    let deck = initialDeck;
    const runoutBoards: Card[][] = [];

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const board = [...prefixBoard];
      while (board.length < 5) {
        const { dealt, remaining } = dealCards(deck, 1);
        board.push(dealt[0]);
        deck = remaining;
      }
      runoutBoards.push(board);
    }

    persistDeck(deck);
    return runoutBoards;
  }

  private buildRemainingDeck(room: Room): {
    deck: Card[];
    persistDeck: (nextDeck: Card[]) => void;
  } {
    const useShortDeckRules = Boolean(room.config.useShortDeckRules);
    const testDeck = this.testDeckService.getDeck(room.id);

    if (testDeck) {
      this.logger.debug(`Using test deck for room ${room.id}`);
      return {
        deck: [...testDeck],
        persistDeck: (nextDeck) => this.testDeckService.setDeck(room.id, nextDeck),
      };
    }

    let deck = shuffleDeck(createDeck({ useShortDeckRules }));
    const dealtCards = [
      ...(room.currentHand?.communityCards ?? []),
      ...room.players.flatMap((player) => player.cards || []),
    ];

    deck = deck.filter(
      (card) =>
        !dealtCards.some(
          (dealt) => dealt.suit === card.suit && dealt.rank === card.rank,
        ),
    );

    return {
      deck,
      persistDeck: () => {},
    };
  }

  /**
   * Determine winner(s) at showdown
   */
  async determineWinner(room: Room): Promise<HandResult> {
    const hand = room.currentHand;
    if (!hand) {
      throw new Error('No active hand');
    }

    this.logger.debug(
      `[determineWinner] START - pot: ${hand.pot}, players: ${room.players.map((p) => `${p.name}: chips=${p.chips}, currentBet=${p.currentBet}`).join(', ')}`,
    );

    const activePlayers = room.players.filter(
      (p) => hand.activePlayers.includes(p.id) && p.status !== 'left',
    );

    if (activePlayers.length === 0) {
      throw new Error('No active players');
    }
    const contributions = this.getHandContributions(room);
    const showdownBoards =
      hand.runoutBoards && hand.runoutBoards.length > 0
        ? hand.runoutBoards.map((board) => [...board])
        : [[...hand.communityCards]];
    const resolvedRunCount: RunCount =
      showdownBoards.length > 1 || hand.runCount === 2 ? 2 : 1;

    // If only one player left, they win
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      this.logger.debug(
        `[determineWinner] Single winner: ${winner.name}, before: chips=${winner.chips}, awarding: ${hand.pot}`,
      );
      winner.chips += hand.pot;

      // Don't evaluate hand if won by fold (may not have enough community cards)
      const winnerCards = winner.cards ?? [];
      const hasEnoughCards =
        winnerCards.length + hand.communityCards.length >= 5;
      const winnerHand = hasEnoughCards
        ? evaluateHand(winnerCards.concat(hand.communityCards), {
            useShortDeckRules: Boolean(room.config.useShortDeckRules),
          })
        : null;
      const winnerRunHands = showdownBoards.map((board, runIndex) => ({
        runIndex,
        hand:
          winnerCards.length + board.length >= 5
            ? evaluateHand(winnerCards.concat(board), {
                useShortDeckRules: Boolean(room.config.useShortDeckRules),
              })
            : null,
      }));
      const evaluationsByPlayerId = new Map<
        string,
        { player: Player; evaluation: ReturnType<typeof evaluateHand> | null }
      >([[winner.id, { player: winner, evaluation: winnerHand }]]);
      const runHandsByPlayerId = new Map<
        string,
        Array<{ runIndex: number; hand: ReturnType<typeof evaluateHand> | null }>
      >([[winner.id, winnerRunHands]]);
      const payouts: PotPayout[] = [
        {
          segmentIndex: 0,
          potType: 'MAIN',
          amount: hand.pot,
          eligiblePlayerIds: activePlayers.map((player) => player.id),
          winnerShares: [
            {
              playerId: winner.id,
              amountWon: hand.pot,
            },
          ],
          uncontested: activePlayers.length === 1,
        },
      ];

      winner.handsWonCount = (winner.handsWonCount ?? 0) + 1;
      const result: HandResult = {
        runCount: resolvedRunCount,
        runouts: showdownBoards.map((board, runIndex) => {
          const runAmount = this.splitAmountAcrossRuns(
            hand.pot,
            resolvedRunCount,
            runIndex,
          );
          const winnerRunHand = winnerRunHands[runIndex]?.hand ?? null;
          return {
            runIndex,
            board: [...board],
            winners:
              runAmount > 0
                ? [
                    {
                      playerId: winner.id,
                      playerName: winner.name,
                      hand: winnerRunHand,
                      amountWon: runAmount,
                    },
                  ]
                : [],
            payouts:
              runAmount > 0
                ? [
                    {
                      segmentIndex: 0,
                      potType: 'MAIN',
                      amount: runAmount,
                      eligiblePlayerIds: activePlayers.map((player) => player.id),
                      winnerShares: [
                        {
                          playerId: winner.id,
                          amountWon: runAmount,
                        },
                      ],
                      uncontested: true,
                    },
                  ]
                : [],
          };
        }),
        winners: [
          {
            playerId: winner.id,
            playerName: winner.name,
            hand: resolvedRunCount === 1 ? winnerHand : null,
            amountWon: hand.pot,
          },
        ],
        playerHands: this.buildResultPlayerHands(
          room,
          evaluationsByPlayerId,
          runHandsByPlayerId,
        ),
        totalPot: hand.pot,
        payouts,
        netByPlayerId: this.buildNetByPlayerId(
          contributions,
          new Map([[winner.id, hand.pot]]),
        ),
      };

      this.captureSettledPlayerCards(room);
      await this.cleanupHand(room, winner.id);
      return result;
    }

    const sidePotSegments = this.buildPotSegments(
      contributions,
      hand.activePlayers,
    );

    // Keep side pots on hand for visibility/debugging (excluding the main pot segment).
    hand.sidePots = sidePotSegments.slice(1);

    const runHandsByPlayerId = new Map<
      string,
      Array<{ runIndex: number; hand: ReturnType<typeof evaluateHand> | null }>
    >();
    const payoutByPlayerId = new Map<string, number>();
    const payouts: PotPayout[] = [];
    const runouts: NonNullable<HandResult['runouts']> = [];
    let distributedTotal = 0;

    const evaluationMapsByRunIndex = showdownBoards.map((board, runIndex) => {
      const evaluationsByPlayerId = this.buildEvaluationsByPlayerId(
        room,
        activePlayers,
        board,
      );

      for (const [playerId, entry] of evaluationsByPlayerId.entries()) {
        const existingRunHands = runHandsByPlayerId.get(playerId) ?? [];
        existingRunHands.push({
          runIndex,
          hand: entry.evaluation,
        });
        runHandsByPlayerId.set(playerId, existingRunHands);
      }

      const runPayout = this.resolveRunPayouts(
        evaluationsByPlayerId,
        sidePotSegments,
        resolvedRunCount,
        runIndex,
      );

      for (const payout of runPayout.payouts) {
        const aggregatePayout = payouts[payout.segmentIndex];
        if (!aggregatePayout) {
          payouts[payout.segmentIndex] = {
            ...payout,
            winnerShares: payout.winnerShares.map((share) => ({ ...share })),
          };
          continue;
        }

        aggregatePayout.amount += payout.amount;
        aggregatePayout.uncontested =
          aggregatePayout.uncontested && payout.uncontested;
        for (const share of payout.winnerShares) {
          const existingShare = aggregatePayout.winnerShares.find(
            (candidate) => candidate.playerId === share.playerId,
          );
          if (existingShare) {
            existingShare.amountWon += share.amountWon;
          } else {
            aggregatePayout.winnerShares.push({ ...share });
          }
        }
      }

      for (const [playerId, amountWon] of runPayout.payoutByPlayerId.entries()) {
        payoutByPlayerId.set(
          playerId,
          (payoutByPlayerId.get(playerId) || 0) + amountWon,
        );
      }
      distributedTotal += runPayout.distributedTotal;

      const runWinners = Array.from(runPayout.payoutByPlayerId.entries())
        .map(([playerId, amountWon]) => {
          const evaluation = evaluationsByPlayerId.get(playerId)!;
          return {
            playerId,
            playerName: evaluation.player.name,
            hand: evaluation.evaluation,
            amountWon,
          };
        })
        .sort((left, right) => right.amountWon - left.amountWon);

      runouts.push({
        runIndex,
        board: [...board],
        winners: runWinners,
        payouts: runPayout.payouts,
      });

      return evaluationsByPlayerId;
    });

    const primaryEvaluationsByPlayerId =
      evaluationMapsByRunIndex[0] ??
      new Map<
        string,
        { player: Player; evaluation: ReturnType<typeof evaluateHand> | null }
      >();

    if (distributedTotal !== hand.pot && evaluationMapsByRunIndex.length > 0) {
      const adjustment = hand.pot - distributedTotal;
      const fallbackWinner = [...primaryEvaluationsByPlayerId.values()].sort(
        (left, right) => compareHands(right.evaluation, left.evaluation),
      )[0];
      payoutByPlayerId.set(
        fallbackWinner.player.id,
        (payoutByPlayerId.get(fallbackWinner.player.id) || 0) + adjustment,
      );
      const targetPayout =
        payouts.find((segment) =>
          segment.winnerShares.some(
            (share) => share.playerId === fallbackWinner.player.id,
          ),
        ) ?? payouts[0];
      if (targetPayout) {
        const existingShare = targetPayout.winnerShares.find(
          (share) => share.playerId === fallbackWinner.player.id,
        );
        if (existingShare) {
          existingShare.amountWon += adjustment;
        } else {
          targetPayout.winnerShares.push({
            playerId: fallbackWinner.player.id,
            amountWon: adjustment,
          });
        }
        targetPayout.amount += adjustment;
      }
      distributedTotal += adjustment;
      this.logger.warn(
        `[determineWinner] Pot distribution adjusted by ${adjustment} to preserve chip conservation`,
      );
    }

    for (const [playerId, amountWon] of payoutByPlayerId.entries()) {
      const player = room.players.find((p) => p.id === playerId);
      if (!player) continue;
      this.logger.debug(
        `[determineWinner] Awarding ${player.name}: before=${player.chips}, amount=${amountWon}, after=${player.chips + amountWon}`,
      );
      player.chips += amountWon;
    }

    const winners = Array.from(payoutByPlayerId.entries())
      .map(([playerId, amountWon]) => {
        const evaluation = primaryEvaluationsByPlayerId.get(playerId)!;
        return {
          playerId,
          playerName: evaluation.player.name,
          hand: resolvedRunCount === 1 ? evaluation.evaluation : null,
          amountWon,
        };
      })
      .sort((a, b) => b.amountWon - a.amountWon);

    for (const winnerEntry of winners) {
      const winnerPlayer = room.players.find(
        (p) => p.id === winnerEntry.playerId,
      );
      if (!winnerPlayer) continue;
      winnerPlayer.handsWonCount = (winnerPlayer.handsWonCount ?? 0) + 1;
    }

    const result: HandResult = {
      runCount: resolvedRunCount,
      runouts,
      winners,
      playerHands: this.buildResultPlayerHands(
        room,
        primaryEvaluationsByPlayerId,
        runHandsByPlayerId,
      ),
      totalPot: hand.pot,
      payouts,
      netByPlayerId: this.buildNetByPlayerId(contributions, payoutByPlayerId),
    };

    this.captureSettledPlayerCards(room);
    await this.cleanupHand(room, winners[0]?.playerId);
    return result;
  }

  private buildEvaluationsByPlayerId(
    room: Room,
    activePlayers: Player[],
    board: Card[],
  ): Map<string, { player: Player; evaluation: ReturnType<typeof evaluateHand> | null }> {
    return new Map(
      activePlayers.map((player) => {
        if (!player.cards || player.cards.length !== 2) {
          throw new Error(
            `Cards unavailable for showdown evaluation: ${player.id}`,
          );
        }

        return [
          player.id,
          {
            player,
            evaluation: evaluateHand(player.cards.concat(board), {
              useShortDeckRules: Boolean(room.config.useShortDeckRules),
            }),
          },
        ];
      }),
    );
  }

  private resolveRunPayouts(
    evaluationsByPlayerId: Map<
      string,
      { player: Player; evaluation: ReturnType<typeof evaluateHand> | null }
    >,
    sidePotSegments: Array<{ amount: number; eligiblePlayers: string[] }>,
    runCount: RunCount,
    runIndex: number,
  ): {
    payouts: PotPayout[];
    payoutByPlayerId: Map<string, number>;
    distributedTotal: number;
  } {
    const payoutByPlayerId = new Map<string, number>();
    const payouts: PotPayout[] = [];
    let distributedTotal = 0;

    for (const [segmentIndex, segment] of sidePotSegments.entries()) {
      const segmentAmount = this.splitAmountAcrossRuns(
        segment.amount,
        runCount,
        runIndex,
      );
      if (segmentAmount <= 0) {
        continue;
      }

      const eligibleEvaluations = segment.eligiblePlayers
        .map((playerId) => evaluationsByPlayerId.get(playerId))
        .filter(
          (
            entry,
          ): entry is {
            player: Player;
            evaluation: ReturnType<typeof evaluateHand> | null;
          } => Boolean(entry),
        )
        .sort((left, right) => compareHands(right.evaluation, left.evaluation));

      if (eligibleEvaluations.length === 0) {
        continue;
      }

      const winningEvaluations = [eligibleEvaluations[0]];
      for (let index = 1; index < eligibleEvaluations.length; index += 1) {
        if (
          compareHands(
            eligibleEvaluations[index].evaluation,
            eligibleEvaluations[0].evaluation,
          ) === 0
        ) {
          winningEvaluations.push(eligibleEvaluations[index]);
        } else {
          break;
        }
      }

      // Preserve the table's existing odd-chip convention inside each run.
      winningEvaluations.sort((left, right) => left.player.position - right.player.position);
      const amountPerWinner = Math.floor(
        segmentAmount / winningEvaluations.length,
      );
      const remainder = segmentAmount % winningEvaluations.length;
      const winnerShares: PotPayout['winnerShares'] = [];

      for (let index = 0; index < winningEvaluations.length; index += 1) {
        const winner = winningEvaluations[index];
        const award = amountPerWinner + (index < remainder ? 1 : 0);
        if (award <= 0) {
          continue;
        }

        payoutByPlayerId.set(
          winner.player.id,
          (payoutByPlayerId.get(winner.player.id) || 0) + award,
        );
        winnerShares.push({
          playerId: winner.player.id,
          amountWon: award,
        });
        distributedTotal += award;
      }

      payouts.push({
        segmentIndex,
        potType: segmentIndex === 0 ? 'MAIN' : 'SIDE',
        amount: segmentAmount,
        eligiblePlayerIds: segment.eligiblePlayers,
        winnerShares,
        uncontested: segment.eligiblePlayers.length === 1,
      });
    }

    return {
      payouts,
      payoutByPlayerId,
      distributedTotal,
    };
  }

  private splitAmountAcrossRuns(
    amount: number,
    runCount: RunCount,
    runIndex: number,
  ): number {
    if (runCount <= 1) {
      return amount;
    }

    const baseAmount = Math.floor(amount / runCount);
    const remainder = amount % runCount;
    return baseAmount + (runIndex < remainder ? 1 : 0);
  }

  private captureSettledPlayerCards(room: Room): void {
    const hand = room.currentHand;
    if (!hand) {
      return;
    }

    hand.settledPlayerCardsByPlayerId = Object.fromEntries(
      room.players
        .filter(
          (
            player,
          ): player is Player & { cards: NonNullable<Player['cards']> } =>
            Array.isArray(player.cards) && player.cards.length > 0,
        )
        .map((player) => [player.id, [...player.cards]]),
    );
  }

  private buildResultPlayerHands(
    room: Room,
    evaluationsByPlayerId: Map<
      string,
      { player: Player; evaluation: ReturnType<typeof evaluateHand> | null }
    >,
    runHandsByPlayerId: Map<
      string,
      Array<{ runIndex: number; hand: ReturnType<typeof evaluateHand> | null }>
    > = new Map(),
  ): HandResult['playerHands'] {
    const hand = room.currentHand!;
    const dealtPlayerIds =
      hand.dealtPlayerIds && hand.dealtPlayerIds.length > 0
        ? hand.dealtPlayerIds
        : room.players
            .filter(
              (player) =>
                Boolean(player.cards) &&
                player.status !== 'waiting' &&
                player.status !== 'left',
            )
            .map((player) => player.id);
    const dealtPlayerIdSet = new Set(dealtPlayerIds);
    const seatPlayers = room.players
      .filter((player) => dealtPlayerIdSet.has(player.id))
      .sort((left, right) => left.position - right.position);

    const revealedPlayerIdSet = new Set(hand.revealedPlayerIds ?? []);
    const showdownContenderIdSet = new Set(hand.showdownDecisionOrder ?? []);
    const activePlayerIdSet = new Set(hand.activePlayers ?? []);

    return seatPlayers.map((player) => {
      const isShown = revealedPlayerIdSet.has(player.id);
      const isShowdownContender = showdownContenderIdSet.has(player.id);
      const isActiveAtSettlement = activePlayerIdSet.has(player.id);

      const resultStatus: HandResult['playerHands'][number]['resultStatus'] =
        isShown
          ? 'shown'
          : isShowdownContender
            ? isActiveAtSettlement
              ? 'hidden_contender'
              : 'folded_at_showdown'
            : isActiveAtSettlement
              ? 'hidden_contender'
              : 'folded_pre_showdown';
      const cardsVisibility: HandResult['playerHands'][number]['cardsVisibility'] =
        isShown ? 'shown' : 'hidden';
      const evaluation =
        evaluationsByPlayerId.get(player.id)?.evaluation ?? null;
      const runHands = runHandsByPlayerId.get(player.id) ?? [];

      return {
        playerId: player.id,
        playerName: player.name,
        cards: cardsVisibility === 'shown' ? (player.cards ?? []) : [],
        hand:
          cardsVisibility === 'shown'
            ? runHands.length <= 1
              ? (runHands[0]?.hand ?? evaluation)
              : null
            : null,
        resultStatus,
        cardsVisibility,
        seatPosition: player.position,
        runHands: runHands.length > 0 ? runHands : undefined,
      };
    });
  }

  private getHandContributions(room: Room): Record<string, number> {
    const hand = room.currentHand!;
    if (Object.keys(hand.potContributions || {}).length > 0) {
      return hand.potContributions;
    }

    // Fallback for legacy hand states that don't have tracked contributions.
    const fallback: Record<string, number> = {};
    const dealtPlayerIds = room.players
      .filter(
        (player) =>
          Boolean(player.cards) &&
          player.status !== 'left' &&
          player.status !== 'waiting',
      )
      .map((player) => player.id);
    const fallbackPlayerIds =
      dealtPlayerIds.length > 0
        ? [...new Set(dealtPlayerIds)]
        : [...new Set(hand.activePlayers)];

    if (fallbackPlayerIds.length === 0 || hand.pot <= 0) {
      return fallback;
    }

    const sortedActive = fallbackPlayerIds.sort((a, b) => {
      const aPos = room.players.find((p) => p.id === a)?.position ?? 0;
      const bPos = room.players.find((p) => p.id === b)?.position ?? 0;
      return aPos - bPos;
    });

    const base = Math.floor(hand.pot / sortedActive.length);
    let remainder = hand.pot % sortedActive.length;
    for (const playerId of sortedActive) {
      const bonus = remainder > 0 ? 1 : 0;
      fallback[playerId] = base + bonus;
      remainder -= bonus;
    }

    hand.potContributions = fallback;
    this.logger.warn(
      `[determineWinner] Missing potContributions for hand ${hand.handNumber}, using fallback split`,
    );
    return fallback;
  }

  private buildPotSegments(
    contributions: Record<string, number>,
    activePlayerIds: string[],
  ): Array<{ amount: number; eligiblePlayers: string[] }> {
    const entries = Object.entries(contributions).filter(
      ([, amount]) => amount > 0,
    );
    if (entries.length === 0) {
      return [];
    }

    const levels = [...new Set(entries.map(([, amount]) => amount))].sort(
      (a, b) => a - b,
    );

    const activeSet = new Set(activePlayerIds);
    const segments: Array<{ amount: number; eligiblePlayers: string[] }> = [];
    let previousLevel = 0;

    for (const level of levels) {
      const contributors = entries
        .filter(([, amount]) => amount >= level)
        .map(([playerId]) => playerId);
      const layerAmount = (level - previousLevel) * contributors.length;
      previousLevel = level;

      if (layerAmount <= 0) {
        continue;
      }

      const eligiblePlayers = contributors.filter((playerId) =>
        activeSet.has(playerId),
      );
      if (eligiblePlayers.length === 0) {
        continue;
      }

      segments.push({
        amount: layerAmount,
        eligiblePlayers,
      });
    }

    return segments;
  }

  private buildNetByPlayerId(
    contributions: Record<string, number>,
    payouts: Map<string, number>,
  ): Record<string, number> {
    const netByPlayerId: Record<string, number> = {};
    const playerIds = new Set<string>([
      ...Object.keys(contributions),
      ...Array.from(payouts.keys()),
    ]);

    for (const playerId of playerIds) {
      netByPlayerId[playerId] =
        (payouts.get(playerId) || 0) - (contributions[playerId] || 0);
    }

    return netByPlayerId;
  }

  /**
   * Get next player to act
   */
  getNextPlayer(room: Room): Player | null {
    const hand = room.currentHand;
    if (!hand) return null;

    const activePlayers = this.getActivePlayers(room);
    if (activePlayers.length === 0) return null;

    const currentTurnPlayer = room.players.find(
      (player) => player.id === hand.currentPlayerTurn,
    );
    if (!currentTurnPlayer) {
      return activePlayers[0];
    }

    return this.getNextPlayerByPosition(
      activePlayers,
      currentTurnPlayer.position,
    );
  }

  /**
   * Check if hand is complete
   */
  isHandComplete(room: Room): boolean {
    const hand = room.currentHand;
    if (!hand) return true;

    // At showdown
    if (hand.bettingRound === 'SHOWDOWN') return true;

    // Fold-outs remove players from activePlayers; if only one remains,
    // the hand is immediately complete (no showdown needed).
    if (hand.activePlayers.length <= 1) return true;

    const activePlayers = this.getActivePlayers(room);
    if (activePlayers.length <= 1) return false;

    return false;
  }

  /**
   * Get active players (not folded, not all-in)
   */
  private getActivePlayers(room: Room): Player[] {
    const hand = room.currentHand;
    if (!hand) return [];

    return this.getPlayersInSeatOrder(
      room.players.filter(
        (p) =>
          hand.activePlayers.includes(p.id) &&
          p.status !== 'folded' &&
          p.status !== 'all-in' &&
          p.status !== 'left' &&
          p.chips > 0,
      ),
    );
  }

  /**
   * Get next dealer position
   */
  private getNextDealerPosition(room: Room, activePlayers: Player[]): number {
    if (activePlayers.length === 0) {
      return 0;
    }

    if (!room.currentHand) {
      return activePlayers[0].position;
    }

    const currentDealer = room.currentHand.dealerPosition;
    const nextDealer = this.getNextPlayerByPosition(
      activePlayers,
      currentDealer,
    );
    return nextDealer?.position ?? activePlayers[0].position;
  }

  private getPlayersInSeatOrder(players: Player[]): Player[] {
    return [...players].sort((left, right) => left.position - right.position);
  }

  private buildPositionLabelsByPlayerId({
    activePlayers,
    dealerPosition,
    smallBlindPosition,
    bigBlindPosition,
  }: {
    activePlayers: Player[];
    dealerPosition: number;
    smallBlindPosition: number;
    bigBlindPosition: number;
  }): Record<string, HandPositionLabel> {
    if (activePlayers.length === 0) {
      return {};
    }

    if (activePlayers.length === 2) {
      return this.buildHeadsUpPositionLabelsByPlayerId({
        activePlayers,
        dealerPosition,
        smallBlindPosition,
        bigBlindPosition,
      });
    }

    const orderedFromButton = this.getPlayersClockwiseFromPosition(
      activePlayers,
      dealerPosition,
    );
    const labels = buildPositionLabels(orderedFromButton.length);
    if (!labels || labels.length !== orderedFromButton.length) {
      return {};
    }

    return Object.fromEntries(
      orderedFromButton.map((player, index) => [player.id, labels[index]]),
    );
  }

  private buildPersistedPlayerSnapshots(
    room: Room,
    options?: {
      includeCards?: boolean;
    },
  ): PersistedRoomPlayerStateSnapshot[] {
    const hand = room.currentHand;
    return this.getPlayersInSeatOrder(room.players).map((player) => ({
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      status: player.status,
      chips: player.chips,
      currentBet: player.currentBet,
      totalBuyIn: player.totalBuyIn,
      lastAction: player.lastAction,
      isActiveInHand: hand ? hand.activePlayers.includes(player.id) : false,
      positionLabel: hand?.positionLabelsByPlayerId?.[player.id] ?? null,
      cards: options?.includeCards ? player.cards : undefined,
    }));
  }

  private buildHeadsUpPositionLabelsByPlayerId({
    activePlayers,
    dealerPosition,
    smallBlindPosition,
    bigBlindPosition,
  }: {
    activePlayers: Player[];
    dealerPosition: number;
    smallBlindPosition: number;
    bigBlindPosition: number;
  }): Record<string, HandPositionLabel> {
    if (activePlayers.length !== 2) {
      return {};
    }

    const playerByPosition = new Map(
      activePlayers.map((player) => [player.position, player]),
    );
    const dealerPlayer = playerByPosition.get(dealerPosition);
    const nonDealerPlayer =
      activePlayers.find((player) => player.position !== dealerPosition) ?? null;

    if (!dealerPlayer || !nonDealerPlayer) {
      return {};
    }

    // Heads-up blind mechanics stay unchanged here; this only aligns
    // the exposed position badge with the agreed UX contract.
    return {
      [dealerPlayer.id]: 'BTN/SB',
      [nonDealerPlayer.id]: 'BB',
    };
  }

  private getPlayersClockwiseFromPosition(
    players: Player[],
    startingPosition: number,
  ): Player[] {
    const sortedPlayers = this.getPlayersInSeatOrder(players);
    const startIndex = sortedPlayers.findIndex(
      (player) => player.position === startingPosition,
    );

    if (startIndex === -1) {
      return sortedPlayers;
    }

    return [
      ...sortedPlayers.slice(startIndex),
      ...sortedPlayers.slice(0, startIndex),
    ];
  }

  private getNextPlayerByPosition(
    players: Player[],
    currentPosition: number,
  ): Player | null {
    if (players.length === 0) {
      return null;
    }

    const sortedPlayers = this.getPlayersInSeatOrder(players);
    return (
      sortedPlayers.find((player) => player.position > currentPosition) ??
      sortedPlayers[0]
    );
  }

  /**
   * Cleanup after hand ends
   */
  private async cleanupHand(
    room: Room,
    preferredPlayerId?: string,
  ): Promise<void> {
    this.logger.debug(
      `[cleanupHand] BEFORE cleanup - players: ${room.players.map((p) => `${p.name}: chips=${p.chips}, currentBet=${p.currentBet}`).join(', ')}`,
    );

    // Reset player states
    for (const player of room.players) {
      player.cards = null;
      player.currentBet = 0;
      player.lastAction = null;
      if (player.status === 'folded' || player.status === 'all-in') {
        player.status = 'connected';
      }
    }

    this.reconcileChipConservation(room, 'cleanupHand', preferredPlayerId);

    this.logger.debug(
      `[cleanupHand] AFTER cleanup - players: ${room.players.map((p) => `${p.name}: chips=${p.chips}, currentBet=${p.currentBet}`).join(', ')}`,
    );
    this.logger.debug(
      `[cleanupHand] Total chips: ${room.players.reduce((sum, p) => sum + p.chips + p.currentBet, 0)}`,
    );

    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(room);
  }

  private reconcileChipConservation(
    room: Room,
    context: string,
    preferredPlayerId?: string,
  ): void {
    const expectedTotal = room.players.reduce(
      (sum, player) => sum + (player.totalBuyIn ?? 0),
      0,
    );
    const actualTotal = room.players.reduce(
      (sum, player) => sum + player.chips + player.currentBet,
      0,
    );
    const delta = expectedTotal - actualTotal;

    if (delta === 0) {
      return;
    }

    this.logger.error(
      `[chip-conservation] ${context} mismatch in room ${room.id}: expected=${expectedTotal}, actual=${actualTotal}, delta=${delta}`,
    );

    const maxAutoAdjustment = Math.max(1, room.players.length);
    if (Math.abs(delta) > maxAutoAdjustment) {
      this.logger.error(
        `[chip-conservation] Large mismatch in room ${room.id}; skipped auto-reconciliation to avoid unfair balance correction`,
      );
      return;
    }

    if (delta > 0) {
      const recipient =
        room.players.find((player) => player.id === preferredPlayerId) ??
        [...room.players].sort(
          (a, b) => b.chips - a.chips || a.position - b.position,
        )[0];
      if (!recipient) {
        return;
      }

      recipient.chips += delta;
      this.logger.warn(
        `[chip-conservation] Credited ${delta} chips to ${recipient.name} in room ${room.id} to restore table invariants`,
      );
      return;
    }

    let remainingToRemove = Math.abs(delta);
    const debitOrder = [...room.players].sort((a, b) => {
      if (preferredPlayerId) {
        if (a.id === preferredPlayerId && b.id !== preferredPlayerId) return -1;
        if (b.id === preferredPlayerId && a.id !== preferredPlayerId) return 1;
      }
      return b.chips - a.chips || a.position - b.position;
    });

    for (const player of debitOrder) {
      if (remainingToRemove <= 0) {
        break;
      }
      const debit = Math.min(player.chips, remainingToRemove);
      player.chips -= debit;
      remainingToRemove -= debit;
    }

    if (remainingToRemove > 0) {
      this.logger.error(
        `[chip-conservation] Failed to fully debit mismatch in room ${room.id}, remaining=${remainingToRemove}`,
      );
      return;
    }

    this.logger.warn(
      `[chip-conservation] Debited ${Math.abs(delta)} chips across stacks in room ${room.id} to restore table invariants`,
    );
  }
}
