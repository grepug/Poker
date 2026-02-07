import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  Room,
  Hand,
  Player,
  BettingRound,
  HandResult,
  Card,
} from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';
import { createDeck, shuffleDeck, dealCards } from '../common/utils/deck';
import { evaluateHand, compareHands } from '../common/utils/hand-evaluator';
import { TestDeckService } from './test-deck.service';

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
    if (room.players.length < 2) {
      throw new Error('Need at least 2 players to start a hand');
    }

    // Auto-refill busted players with starting chips and track it as an added buy-in.
    for (const player of room.players) {
      if (player.chips === 0) {
        player.chips = room.config.startingChips;
        player.totalBuyIn = (player.totalBuyIn ?? 0) + room.config.startingChips;
      }
    }

    const handNumber = room.currentHand ? room.currentHand.handNumber + 1 : 1;

    // Determine positions
    const dealerPosition = this.getNextDealerPosition(room);
    const activePlayers = room.players.filter(
      (p) => p.chips > 0 && p.status !== 'left',
    );
    const activePlayerIds = activePlayers.map((p) => p.id);
    const playerCount = activePlayers.length;

    if (playerCount < 2) {
      throw new Error('Need at least 2 players with chips');
    }

    const smallBlindPosition = (dealerPosition + 1) % playerCount;
    const bigBlindPosition = (dealerPosition + 2) % playerCount;

    // Collect blinds
    const smallBlindPlayer = activePlayers[smallBlindPosition];
    const bigBlindPlayer = activePlayers[bigBlindPosition];

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
      deck = shuffleDeck(createDeck());
    }

    for (const player of activePlayers) {
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
    const firstToAct =
      playerCount === 2
        ? smallBlindPosition
        : (bigBlindPosition + 1) % playerCount;
    const currentPlayerTurn = activePlayers[firstToAct].id;

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
      startedAt: Date.now(),
    };

    room.currentHand = hand;
    room.gameState = 'IN_PROGRESS';
    room.lastActivityAt = Date.now();

    await this.storageService.saveRoom(room);
    this.logger.log(`Hand #${handNumber} started in room ${room.id}`);

    return hand;
  }

  /**
   * Advance to next betting round
   */
  async advanceBettingRound(room: Room): Promise<BettingRound> {
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
      deck = shuffleDeck(createDeck());

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

      // Update test deck if in test mode
      if (testDeck) {
        this.testDeckService.setDeck(room.id, deck);
      }

      room.lastActivityAt = Date.now();
      await this.storageService.saveRoom(room);
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

    for (const player of room.players) {
      player.currentBet = 0;
    }

    // Set first to act (first active player after dealer)
    const activePlayers = this.getActivePlayers(room);
    if (activePlayers.length > 0) {
      const dealerIdx = activePlayers.findIndex(
        (p) =>
          room.players.findIndex((rp) => rp.id === p.id) ===
          hand.dealerPosition,
      );
      const nextIdx = (dealerIdx + 1) % activePlayers.length;
      hand.currentPlayerTurn = activePlayers[nextIdx].id;
    }

    room.lastActivityAt = Date.now();
    await this.storageService.saveRoom(room);

    this.logger.log(`Advanced to ${hand.bettingRound} in room ${room.id}`);
    return hand.bettingRound;
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

    const activePlayers = room.players.filter((p) =>
      hand.activePlayers.includes(p.id),
    );

    if (activePlayers.length === 0) {
      throw new Error('No active players');
    }

    // If only one player left, they win
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      this.logger.debug(
        `[determineWinner] Single winner: ${winner.name}, before: chips=${winner.chips}, awarding: ${hand.pot}`,
      );
      winner.chips += hand.pot;

      // Don't evaluate hand if won by fold (may not have enough community cards)
      const hasEnoughCards =
        winner.cards!.length + hand.communityCards.length >= 5;
      const winnerHand = hasEnoughCards
        ? evaluateHand(winner.cards!.concat(hand.communityCards))
        : null;

      const result: HandResult = {
        winners: [
          {
            playerId: winner.id,
            playerName: winner.name,
            hand: winnerHand,
            amountWon: hand.pot,
          },
        ],
        playerHands: [
          {
            playerId: winner.id,
            playerName: winner.name,
            cards: winner.cards!,
            hand: winnerHand,
          },
        ],
        totalPot: hand.pot,
      };

      await this.cleanupHand(room);
      return result;
    }

    // Evaluate all hands
    const evaluations = activePlayers.map((player) => ({
      player,
      evaluation: evaluateHand(player.cards!.concat(hand.communityCards)),
    }));

    const evaluationsByPlayerId = new Map(
      evaluations.map((entry) => [entry.player.id, entry]),
    );
    const sidePotSegments = this.buildPotSegments(
      this.getHandContributions(room),
      hand.activePlayers,
    );

    // Keep side pots on hand for visibility/debugging (excluding the main pot segment).
    hand.sidePots = sidePotSegments.slice(1);

    const payoutByPlayerId = new Map<string, number>();
    let distributedTotal = 0;

    for (const segment of sidePotSegments) {
      const eligibleEvaluations = segment.eligiblePlayers
        .map((playerId) => evaluationsByPlayerId.get(playerId))
        .filter((entry): entry is (typeof evaluations)[number] => !!entry)
        .sort((a, b) => compareHands(b.evaluation, a.evaluation));

      if (eligibleEvaluations.length === 0) {
        continue;
      }

      const winningEvaluations = [eligibleEvaluations[0]];
      for (let i = 1; i < eligibleEvaluations.length; i++) {
        if (
          compareHands(
            eligibleEvaluations[i].evaluation,
            eligibleEvaluations[0].evaluation,
          ) === 0
        ) {
          winningEvaluations.push(eligibleEvaluations[i]);
        } else {
          break;
        }
      }

      // Split odd chips deterministically by table position to preserve total chips.
      winningEvaluations.sort((a, b) => a.player.position - b.player.position);
      const amountPerWinner = Math.floor(
        segment.amount / winningEvaluations.length,
      );
      const remainder = segment.amount % winningEvaluations.length;

      for (let i = 0; i < winningEvaluations.length; i++) {
        const winner = winningEvaluations[i];
        const award = amountPerWinner + (i < remainder ? 1 : 0);
        payoutByPlayerId.set(
          winner.player.id,
          (payoutByPlayerId.get(winner.player.id) || 0) + award,
        );
        distributedTotal += award;
      }
    }

    if (distributedTotal !== hand.pot && evaluations.length > 0) {
      const adjustment = hand.pot - distributedTotal;
      const fallbackWinner = evaluations
        .slice()
        .sort((a, b) => compareHands(b.evaluation, a.evaluation))[0];
      payoutByPlayerId.set(
        fallbackWinner.player.id,
        (payoutByPlayerId.get(fallbackWinner.player.id) || 0) + adjustment,
      );
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
        const evaluation = evaluationsByPlayerId.get(playerId)!;
        return {
          playerId,
          playerName: evaluation.player.name,
          hand: evaluation.evaluation,
          amountWon,
        };
      })
      .sort((a, b) => b.amountWon - a.amountWon);

    const result: HandResult = {
      winners,
      playerHands: evaluations
        .slice()
        .sort((a, b) => compareHands(b.evaluation, a.evaluation))
        .map(({ player, evaluation }) => ({
          playerId: player.id,
          playerName: player.name,
          cards: player.cards!,
          hand: evaluation,
        })),
      totalPot: hand.pot,
    };

    await this.cleanupHand(room);
    return result;
  }

  private getHandContributions(room: Room): Record<string, number> {
    const hand = room.currentHand!;
    if (Object.keys(hand.potContributions || {}).length > 0) {
      return hand.potContributions;
    }

    // Fallback for legacy hand states that don't have tracked contributions.
    const fallback: Record<string, number> = {};
    const activePlayerIds = [...hand.activePlayers];
    if (activePlayerIds.length === 0 || hand.pot <= 0) {
      return fallback;
    }

    const sortedActive = activePlayerIds.sort((a, b) => {
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

  /**
   * Get next player to act
   */
  getNextPlayer(room: Room): Player | null {
    const hand = room.currentHand;
    if (!hand) return null;

    const activePlayers = this.getActivePlayers(room);
    if (activePlayers.length === 0) return null;

    const currentIdx = activePlayers.findIndex(
      (p) => p.id === hand.currentPlayerTurn,
    );
    if (currentIdx === -1) return activePlayers[0];

    const nextIdx = (currentIdx + 1) % activePlayers.length;
    return activePlayers[nextIdx];
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

    return room.players.filter(
      (p) =>
        hand.activePlayers.includes(p.id) &&
        p.status !== 'folded' &&
        p.status !== 'all-in' &&
        p.chips > 0,
    );
  }

  /**
   * Get next dealer position
   */
  private getNextDealerPosition(room: Room): number {
    if (!room.currentHand) {
      return 0; // First hand, start at position 0
    }

    const activePlayers = room.players.filter(
      (p) => p.chips > 0 && p.status !== 'left',
    );
    const currentDealer = room.currentHand.dealerPosition;

    return (currentDealer + 1) % activePlayers.length;
  }

  /**
   * Cleanup after hand ends
   */
  private async cleanupHand(room: Room): Promise<void> {
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

    this.logger.debug(
      `[cleanupHand] AFTER cleanup - players: ${room.players.map((p) => `${p.name}: chips=${p.chips}, currentBet=${p.currentBet}`).join(', ')}`,
    );
    this.logger.debug(
      `[cleanupHand] Total chips: ${room.players.reduce((sum, p) => sum + p.chips + p.currentBet, 0)}`,
    );

    room.lastActivityAt = Date.now();
    await this.storageService.saveRoom(room);
  }
}
