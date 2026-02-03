import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Room, Player, PlayerAction } from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';

@Injectable()
export class BettingService {
  private readonly logger = new Logger(BettingService.name);

  constructor(
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  /**
   * Validate if a player action is legal
   */
  validateAction(
    room: Room,
    playerId: string,
    action: PlayerAction,
    amount?: number,
  ): { valid: boolean; reason?: string } {
    const hand = room.currentHand;
    if (!hand) {
      return { valid: false, reason: 'No active hand' };
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      return { valid: false, reason: 'Player not found' };
    }

    if (hand.currentPlayerTurn !== playerId) {
      return { valid: false, reason: 'Not your turn' };
    }

    if (!hand.activePlayers.includes(playerId)) {
      return { valid: false, reason: 'Not in active hand' };
    }

    switch (action) {
      case 'fold':
        return { valid: true };

      case 'check':
        if (hand.currentBet > player.currentBet) {
          return { valid: false, reason: 'Cannot check, must call or raise' };
        }
        return { valid: true };

      case 'call':
        const callAmount = hand.currentBet - player.currentBet;
        if (callAmount === 0) {
          return { valid: false, reason: 'Nothing to call, use check' };
        }
        if (player.chips < callAmount) {
          return { valid: false, reason: 'Insufficient chips, go all-in' };
        }
        return { valid: true };

      case 'raise':
        if (!amount || amount <= 0) {
          return { valid: false, reason: 'Invalid raise amount' };
        }
        const minRaise = this.calculateMinRaise(room);
        if (amount < minRaise) {
          return { valid: false, reason: `Minimum raise is ${minRaise}` };
        }
        if (player.chips < amount) {
          return { valid: false, reason: 'Insufficient chips' };
        }
        return { valid: true };

      case 'all-in':
        return { valid: true };

      default:
        return { valid: false, reason: 'Invalid action' };
    }
  }

  /**
   * Process a player action
   */
  async processAction(
    room: Room,
    playerId: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<void> {
    const hand = room.currentHand;
    if (!hand) {
      throw new Error('No active hand');
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    // Validate action
    const validation = this.validateAction(room, playerId, action, amount);
    if (!validation.valid) {
      throw new Error(validation.reason || 'Invalid action');
    }

    switch (action) {
      case 'fold':
        this.processFold(room, player);
        break;

      case 'check':
        this.processCheck(room, player);
        break;

      case 'call':
        this.processCall(room, player);
        break;

      case 'raise':
        this.processRaise(room, player, amount!);
        break;

      case 'all-in':
        this.processAllIn(room, player);
        break;
    }

    // Mark player as acted this round
    hand.roundActions[playerId] = true;

    room.lastActivityAt = Date.now();
    await this.storageService.saveRoom(room);

    this.logger.log(`Player ${player.name} ${action} in room ${room.id}`);
  }

  /**
   * Calculate minimum raise amount
   */
  calculateMinRaise(room: Room): number {
    const hand = room.currentHand;
    if (!hand) return 0;

    // Minimum raise is 2x the current bet, or 2x big blind if no bets
    const minRaise = Math.max(hand.currentBet * 2, room.config.bigBlind * 2);
    return minRaise;
  }

  /**
   * Check if betting round is complete
   */
  isBettingRoundComplete(room: Room): boolean {
    const hand = room.currentHand;
    if (!hand) return true;

    const activePlayers = room.players.filter(
      (p) =>
        hand.activePlayers.includes(p.id) &&
        p.status !== 'folded' &&
        p.status !== 'all-in',
    );

    // If there's an outstanding bet that hasn't been called, round is not complete
    const playersWithUnmatchedBet = room.players.filter(
      (p) =>
        hand.activePlayers.includes(p.id) &&
        p.status !== 'folded' &&
        p.currentBet < hand.currentBet,
    );

    this.logger.debug(
      `[isBettingRoundComplete] active=${activePlayers.length}, unmatched=${playersWithUnmatchedBet.length}, round=${hand.bettingRound}`,
    );

    if (playersWithUnmatchedBet.length > 0) {
      return false;
    }

    // Only one player left who can act
    if (activePlayers.length <= 1) {
      this.logger.debug('[isBettingRoundComplete] TRUE - ≤1 active players');
      return true;
    }

    // Check if all active players have acted
    const allActed = activePlayers.every((p) => hand.roundActions[p.id]);
    if (!allActed) return false;

    // Check if all bets are equal
    const allBetsEqual = activePlayers.every(
      (p) => p.currentBet === hand.currentBet,
    );
    return allBetsEqual;
  }

  /**
   * Process fold action
   */
  private processFold(room: Room, player: Player): void {
    const hand = room.currentHand!;

    player.status = 'folded';
    player.lastAction = 'fold';

    // Remove from active players
    hand.activePlayers = hand.activePlayers.filter((id) => id !== player.id);
  }

  /**
   * Process check action
   */
  private processCheck(room: Room, player: Player): void {
    player.lastAction = 'check';
  }

  /**
   * Process call action
   */
  private processCall(room: Room, player: Player): void {
    const hand = room.currentHand!;
    const callAmount = hand.currentBet - player.currentBet;

    if (callAmount >= player.chips) {
      // This is effectively all-in
      this.processAllIn(room, player);
      return;
    }

    player.chips -= callAmount;
    player.currentBet += callAmount;
    hand.pot += callAmount;
    player.lastAction = 'call';
  }

  /**
   * Process raise action
   */
  private processRaise(room: Room, player: Player, raiseAmount: number): void {
    const hand = room.currentHand!;

    // Total amount player needs to put in
    const callAmount = hand.currentBet - player.currentBet;
    const totalAmount = callAmount + raiseAmount;

    if (totalAmount >= player.chips) {
      // This is effectively all-in
      this.processAllIn(room, player);
      return;
    }

    player.chips -= totalAmount;
    player.currentBet += totalAmount;
    hand.pot += totalAmount;
    hand.currentBet = player.currentBet;
    player.lastAction = 'raise';

    // Reset round actions since bet increased
    hand.roundActions = { [player.id]: true };
  }

  /**
   * Process all-in action
   */
  private processAllIn(room: Room, player: Player): void {
    const hand = room.currentHand!;

    const allInAmount = player.chips;
    player.currentBet += allInAmount;
    hand.pot += allInAmount;
    player.chips = 0;
    player.status = 'all-in';
    player.lastAction = 'all-in';

    // If all-in is more than current bet, it becomes the new bet
    if (player.currentBet > hand.currentBet) {
      hand.currentBet = player.currentBet;
      // Reset round actions
      hand.roundActions = { [player.id]: true };
    }
  }

  /**
   * Handle all-in scenarios with side pots
   * (Simplified - full implementation would handle multiple side pots)
   */
  handleAllIn(room: Room, playerId: string, amount: number): void {
    const hand = room.currentHand;
    if (!hand) return;

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;

    // Create side pot if needed
    const eligiblePlayers = room.players
      .filter(
        (p) => hand.activePlayers.includes(p.id) && p.currentBet >= amount,
      )
      .map((p) => p.id);

    if (eligiblePlayers.length > 1) {
      hand.sidePots.push({
        amount: amount * eligiblePlayers.length,
        eligiblePlayers,
      });
    }
  }
}
