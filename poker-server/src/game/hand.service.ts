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

    // Give starting chips to players who don't have any
    for (const player of room.players) {
      if (player.chips === 0) {
        player.chips = room.config.startingChips;
        player.totalBuyIn = room.config.startingChips;
      }
    }

    const handNumber = room.currentHand ? room.currentHand.handNumber + 1 : 1;

    // Determine positions
    const dealerPosition = this.getNextDealerPosition(room);
    const activePlayers = room.players.filter(
      (p) => p.chips > 0 && p.status !== 'left',
    );
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

    // Deal cards - use test deck if available
    let deck: Card[];
    const testDeck = this.testDeckService.getDeck(room.id);

    if (testDeck) {
      this.logger.debug(`Using test deck for room ${room.id}`);
      deck = testDeck;
    } else {
      deck = shuffleDeck(createDeck());
    }

    const activePlayerIds = activePlayers.map((p) => p.id);

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
      playerCount === 2 ? smallBlindPosition : (bigBlindPosition + 1) % playerCount;
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
      activePlayers: activePlayerIds,
      roundActions: {},
      sidePots: [],
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

    // Sort by hand strength
    evaluations.sort((a, b) => compareHands(b.evaluation, a.evaluation));

    // Handle ties
    const winners = [evaluations[0]];
    for (let i = 1; i < evaluations.length; i++) {
      if (
        compareHands(evaluations[i].evaluation, evaluations[0].evaluation) === 0
      ) {
        winners.push(evaluations[i]);
      } else {
        break;
      }
    }

    // Distribute pot
    const amountPerWinner = Math.floor(hand.pot / winners.length);
    this.logger.debug(
      `[determineWinner] Distributing pot: ${hand.pot} / ${winners.length} winners = ${amountPerWinner} each`,
    );
    for (const { player } of winners) {
      this.logger.debug(
        `[determineWinner] Awarding ${player.name}: before=${player.chips}, after=${player.chips + amountPerWinner}`,
      );
      player.chips += amountPerWinner;
    }

    const result: HandResult = {
      winners: winners.map(({ player, evaluation }) => ({
        playerId: player.id,
        playerName: player.name,
        hand: evaluation,
        amountWon: amountPerWinner,
      })),
      playerHands: evaluations.map(({ player, evaluation }) => ({
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

    const activePlayers = this.getActivePlayers(room);

    // Only one player left (others folded) - hand is complete
    if (activePlayers.length <= 1) {
      // But only if there are actual non-all-in players left, or someone folded
      const allPlayers = room.players.filter((p) =>
        hand.activePlayers.includes(p.id),
      );
      const foldedPlayers = allPlayers.filter((p) => p.status === 'folded');

      // If someone folded, hand is complete
      if (foldedPlayers.length > 0) return true;

      // If everyone is all-in, hand is NOT complete yet (need to deal cards)
      // The all-in logic in advanceBettingRound will handle this
      return false;
    }

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
