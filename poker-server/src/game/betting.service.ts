import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  PersistedPlayerActionPayload,
  PersistedRobotDecisionMetadata,
  PersistedRoomPlayerStateSnapshot,
  Player,
  PlayerAction,
  PlayerActionDisplayKind,
  Room,
} from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';
import { roomEvent, roomWrite } from '../storage/room-write.factory';

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
    options?: {
      actionId?: string | null;
      robotDecision?: PersistedRobotDecisionMetadata;
    },
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

    const actionContext = this.buildPlayerActionContext(
      room,
      player,
      action,
      amount,
      options?.actionId ?? null,
    );

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

    this.trackVpip(room, player.id, action);

    // Mark player as acted this round
    hand.roundActions[playerId] = true;

    const resolvedAction = player.lastAction ?? action;
    const displayKind = this.toDisplayKind(
      resolvedAction,
      actionContext.decision.currentBetBefore,
    );
    const committedAmount = Math.max(
      0,
      actionContext.decision.playerChipsBefore - player.chips,
    );

    const payload: PersistedPlayerActionPayload = {
      action,
      amount: amount ?? null,
      playerStatus: player.status,
      playerChips: player.chips,
      playerCurrentBet: player.currentBet,
      pot: hand.pot,
      currentBet: hand.currentBet,
      ...(player.isRobot && options?.robotDecision
        ? { robotDecision: options.robotDecision }
        : {}),
      request: actionContext.request,
      decision: actionContext.decision,
      result: {
        resolvedAction,
        displayKind,
        committedAmount,
        totalBetAfterAction: player.currentBet,
        playerStatusAfter: player.status,
        playerChipsAfter: player.chips,
        playerCurrentBetAfter: player.currentBet,
        potAfter: hand.pot,
        currentBetAfter: hand.currentBet,
        lastRaiseSizeAfter: hand.lastRaiseSize,
        activePlayerIds: [...hand.activePlayers],
        potContributions: { ...hand.potContributions },
        players: this.buildPlayerStateSnapshots(room),
      },
    };

    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'PLAYER_ACTION',
          actor: {
            source: 'BETTING_SERVICE',
            playerId: player.id,
            playerName: player.name,
          },
          handNumber: hand.handNumber,
          street: hand.bettingRound,
          payload,
        }),
      ),
    );

    this.logger.log(`Player ${player.name} ${action} in room ${room.id}`);
  }

  /**
   * Calculate minimum raise amount
   * Poker rule: Minimum raise = size of the previous raise
   */
  calculateMinRaise(room: Room): number {
    const hand = room.currentHand;
    if (!hand) return 0;

    // Minimum raise is the size of the last raise
    // If no raise yet, it's the big blind amount
    return hand.lastRaiseSize;
  }

  getLegalActions(room: Room, playerId: string): PlayerAction[] {
    const minRaise = this.calculateMinRaise(room);
    const candidates: Array<{
      action: PlayerAction;
      amount?: number;
    }> = [
      { action: 'fold' },
      { action: 'check' },
      { action: 'call' },
      { action: 'raise', amount: minRaise },
      { action: 'all-in' },
    ];

    return candidates
      .filter((candidate) =>
        this.validateAction(
          room,
          playerId,
          candidate.action,
          candidate.amount,
        ).valid,
      )
      .map((candidate) => candidate.action);
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
        p.status !== 'all-in' &&
        p.status !== 'left',
    );

    // If there's an outstanding bet that hasn't been called, round is not complete
    const playersWithUnmatchedBet = room.players.filter(
      (p) =>
        hand.activePlayers.includes(p.id) &&
        p.status !== 'folded' &&
        p.status !== 'all-in' &&
        p.status !== 'left' &&
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
    this.addToPot(hand, player.id, callAmount);
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
    this.addToPot(hand, player.id, totalAmount);
    hand.currentBet = player.currentBet;

    // Track the raise size for minimum raise calculations
    hand.lastRaiseSize = raiseAmount;
    hand.showdownLastAggressorPlayerId = player.id;

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
    this.addToPot(hand, player.id, allInAmount);
    player.chips = 0;
    player.status = 'all-in';
    player.lastAction = 'all-in';

    // If all-in is more than current bet, it becomes the new bet
    if (player.currentBet > hand.currentBet) {
      hand.currentBet = player.currentBet;
      hand.showdownLastAggressorPlayerId = player.id;
      // Reset round actions
      hand.roundActions = { [player.id]: true };
    }
  }

  private addToPot(hand: Room['currentHand'], playerId: string, amount: number) {
    if (!hand || amount <= 0) {
      return;
    }

    hand.pot += amount;
    if (!hand.potContributions) {
      hand.potContributions = {};
    }
    hand.potContributions[playerId] =
      (hand.potContributions[playerId] || 0) + amount;
  }

  private trackVpip(room: Room, playerId: string, action: PlayerAction): void {
    const hand = room.currentHand;
    if (!hand) return;
    if (hand.bettingRound !== 'PRE_FLOP') return;
    if (action !== 'call' && action !== 'raise' && action !== 'all-in') return;

    const vpipPlayerIds = hand.vpipPlayerIds ?? [];
    if (vpipPlayerIds.includes(playerId)) return;

    vpipPlayerIds.push(playerId);
    hand.vpipPlayerIds = vpipPlayerIds;

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) return;
    player.vpipHandsCount = (player.vpipHandsCount ?? 0) + 1;
  }

  private buildPlayerActionContext(
    room: Room,
    player: Player,
    action: PlayerAction,
    amount: number | undefined,
    actionId: string | null,
  ): Pick<PersistedPlayerActionPayload, 'request' | 'decision'> {
    const hand = room.currentHand!;
    const callAmountBefore = Math.max(0, hand.currentBet - player.currentBet);
    const minimumRaiseBy = this.calculateMinRaise(room);

    return {
      request: {
        actionId,
        action,
        amount: amount ?? null,
      },
      decision: {
        currentPlayerTurnBefore: hand.currentPlayerTurn,
        playerStatusBefore: player.status,
        playerChipsBefore: player.chips,
        playerCurrentBetBefore: player.currentBet,
        potBefore: hand.pot,
        currentBetBefore: hand.currentBet,
        lastRaiseSizeBefore: hand.lastRaiseSize,
        callAmountBefore,
        minimumRaiseBy,
        minimumRaiseTo: hand.currentBet + minimumRaiseBy,
        maximumBetTo: player.currentBet + player.chips,
        facingBet: hand.currentBet > player.currentBet,
        legalActions: this.getLegalActions(room, player.id),
        activePlayerIds: [...hand.activePlayers],
        communityCards: [...hand.communityCards],
        potContributions: { ...hand.potContributions },
        players: this.buildPlayerStateSnapshots(room),
      },
    };
  }

  private buildPlayerStateSnapshots(room: Room): PersistedRoomPlayerStateSnapshot[] {
    const hand = room.currentHand;
    return [...room.players]
      .sort((left, right) => left.position - right.position)
      .map((player) => ({
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
      }));
  }

  private toDisplayKind(
    action: PlayerAction,
    currentBetBefore: number,
  ): PlayerActionDisplayKind {
    switch (action) {
      case 'fold':
        return 'fold';
      case 'check':
        return 'check';
      case 'call':
        return 'call-to';
      case 'all-in':
        return 'all-in-to';
      case 'raise':
        return currentBetBefore <= 0 ? 'bet-to' : 'raise-to';
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
