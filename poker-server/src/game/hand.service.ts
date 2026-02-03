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

@Injectable()
export class HandService {
  private readonly logger = new Logger(HandService.name);

  constructor(
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
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

    // Deal cards
    let deck = shuffleDeck(createDeck());
    const activePlayerIds = activePlayers.map((p) => p.id);

    for (const player of activePlayers) {
      const { dealt, remaining } = dealCards(deck, 2);
      player.cards = dealt;
      player.status = 'connected';
      deck = remaining;
    }

    // First to act is left of big blind (or dealer if heads-up)
    const firstToAct =
      playerCount === 2 ? dealerPosition : (bigBlindPosition + 1) % playerCount;
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

    let deck = shuffleDeck(createDeck());

    // Remove already dealt cards
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

    switch (hand.bettingRound) {
      case 'PRE_FLOP':
        // Deal 3 cards (flop)
        const { dealt: flop } = dealCards(deck, 3);
        hand.communityCards = flop;
        hand.bettingRound = 'FLOP';
        break;

      case 'FLOP':
        // Deal 1 card (turn)
        const { dealt: turn } = dealCards(deck, 1);
        hand.communityCards.push(turn[0]);
        hand.bettingRound = 'TURN';
        break;

      case 'TURN':
        // Deal 1 card (river)
        const { dealt: river } = dealCards(deck, 1);
        hand.communityCards.push(river[0]);
        hand.bettingRound = 'RIVER';
        break;

      case 'RIVER':
        hand.bettingRound = 'SHOWDOWN';
        break;

      case 'SHOWDOWN':
        throw new Error('Already at showdown');
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

    const activePlayers = room.players.filter((p) =>
      hand.activePlayers.includes(p.id),
    );

    if (activePlayers.length === 0) {
      throw new Error('No active players');
    }

    // If only one player left, they win
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.chips += hand.pot;

      const result: HandResult = {
        winners: [
          {
            playerId: winner.id,
            playerName: winner.name,
            hand: evaluateHand(winner.cards!.concat(hand.communityCards)),
            amountWon: hand.pot,
          },
        ],
        playerHands: [
          {
            playerId: winner.id,
            playerName: winner.name,
            cards: winner.cards!,
            hand: evaluateHand(winner.cards!.concat(hand.communityCards)),
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
    for (const { player } of winners) {
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

    const activePlayers = this.getActivePlayers(room);

    // Only one player left
    if (activePlayers.length <= 1) return true;

    // At showdown
    if (hand.bettingRound === 'SHOWDOWN') return true;

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
    // Reset player states
    for (const player of room.players) {
      player.cards = null;
      player.currentBet = 0;
      player.lastAction = null;
      if (player.status === 'folded' || player.status === 'all-in') {
        player.status = 'connected';
      }
    }

    room.lastActivityAt = Date.now();
    await this.storageService.saveRoom(room);
  }
}
