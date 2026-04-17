import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  CompletedGameHistoryExport,
  CompletedHandHistoryAction,
  CompletedHandHistoryExport,
  CompletedHandHistorySeat,
  PersistedBettingRoundAdvancedPayload,
  PersistedHandSettlement,
  PersistedHandStartedPayload,
  PersistedPlayerActionPayload,
  PersistedRoomEventRecord,
  Room,
  RoomPersistedWrite,
  SavedGameDetail,
  SavedGameHandAnalysis,
  SavedGameParticipant,
  SavedGameReviewTargets,
  SavedGameSummary,
  shouldIncludeArchivedRankingParticipant,
} from 'poker-types';
import type { IStorageService } from '../common/interfaces/storage.interface';
import type { IHandHistoryStorageService } from '../common/interfaces/hand-history-storage.interface';
import type { ISavedGameArchiveStorageService } from '../common/interfaces/saved-game-archive-storage.interface';
import { DRIZZLE_DB } from '../db/database.constants';
import type { PokerDb } from '../db/database.module';
import {
  handEventsTable,
  roomEventsTable,
  roomSnapshotsTable,
  savedGameArchivesTable,
  savedGameUserIndexesTable,
} from '../db/schema';
import type {
  ArchivedRoomPlayer,
  SavedGameArchiveRecord,
  StoredRoomProjection,
} from './postgres-storage.types';

@Injectable()
export class PostgresStorageService
  implements
    IStorageService,
    IHandHistoryStorageService,
    ISavedGameArchiveStorageService
{
  private readonly logger = new Logger(PostgresStorageService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: PokerDb) {}

  async persistRoom(room: Room, write?: RoomPersistedWrite): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRoom(tx, room.id);

      const currentProjection = await this.loadProjection(room.id, tx);
      let nextSeq = currentProjection?.snapshot.lastRoomEventSeq ?? 0;
      const timestamp = Number(room.lastActivityAt || Date.now());
      const providedEvents = write?.events ?? [];

      const roomEvents: PersistedRoomEventRecord[] = providedEvents.map((event) => ({
        ...event,
        recordId: randomUUID(),
        seq: ++nextSeq,
        timestamp,
      }));

      const snapshotEvent: PersistedRoomEventRecord = {
        recordId: randomUUID(),
        seq: ++nextSeq,
        roomId: room.id,
        handNumber: room.currentHand?.handNumber ?? null,
        street: room.currentHand?.bettingRound ?? null,
        timestamp,
        type: 'ROOM_STATE_UPDATED',
        actor: { source: 'SYSTEM' },
        payload: {
          room,
        },
      };
      roomEvents.push(snapshotEvent);

      if (roomEvents.length > 0) {
        await tx.insert(roomEventsTable).values(
          roomEvents.map((event) => ({
            roomId: event.roomId,
            seq: event.seq,
            recordId: event.recordId,
            timestamp: event.timestamp,
            type: event.type,
            handNumber: event.handNumber ?? null,
            street: event.street ?? null,
            actor: event.actor ?? null,
            payload: event.payload,
          })),
        );

        const handEvents = roomEvents.filter(
          (event) => event.handNumber && event.type !== 'ROOM_STATE_UPDATED',
        );
        if (handEvents.length > 0) {
          await tx.insert(handEventsTable).values(
            handEvents.map((event) => ({
              roomId: event.roomId,
              handNumber: event.handNumber!,
              seq: event.seq,
              timestamp: event.timestamp,
              type: event.type,
              event,
            })),
          );
        }
      }

      await this.writeProjection(
        room.id,
        {
          snapshot: {
            lastRoomEventSeq: nextSeq,
            updatedAt: timestamp,
          },
          room,
        },
        tx,
      );
    });
  }

  async getRoom(roomId: string): Promise<Room | null> {
    const projection = await this.loadProjection(roomId);
    return projection?.room ?? null;
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRoom(tx, roomId);
      await tx.delete(handEventsTable).where(eq(handEventsTable.roomId, roomId));
      await tx.delete(roomEventsTable).where(eq(roomEventsTable.roomId, roomId));
      await tx
        .delete(roomSnapshotsTable)
        .where(eq(roomSnapshotsTable.roomId, roomId));
    });
  }

  async getAllRooms(): Promise<Room[]> {
    const rows = await this.db.select().from(roomSnapshotsTable);
    return rows.map((row) => row.room);
  }

  async roomExists(roomId: string): Promise<boolean> {
    return Boolean(await this.getRoom(roomId));
  }

  async getCompletedHandHistory(
    roomId: string,
    handNumber: number,
    requesterPlayerId: string,
  ): Promise<CompletedHandHistoryExport | null> {
    const rows = await this.db
      .select({ event: handEventsTable.event })
      .from(handEventsTable)
      .where(
        and(
          eq(handEventsTable.roomId, roomId),
          eq(handEventsTable.handNumber, handNumber),
        ),
      )
      .orderBy(asc(handEventsTable.seq));

    const events = rows.map((row) => row.event);
    if (events.length === 0) {
      return null;
    }

    const handStarted = events.find(
      (event) => event.type === 'HAND_STARTED',
    )?.payload as PersistedHandStartedPayload | undefined;
    const handSettled = events.find(
      (event) => event.type === 'HAND_SETTLED',
    )?.payload as PersistedHandSettlement | undefined;

    if (!handStarted || !handSettled?.result) {
      return null;
    }

    const seatSnapshots = [...(handStarted.players ?? [])].sort(
      (left, right) => left.position - right.position,
    );
    const seatSnapshotByPlayerId = new Map(
      seatSnapshots.map((seat) => [seat.playerId, seat]),
    );
    const playerHandByPlayerId = new Map(
      (handSettled.result.playerHands ?? []).map((playerHand) => [
        playerHand.playerId,
        playerHand,
      ]),
    );
    const revealedPlayerIdSet = new Set(
      handSettled.revealedPlayerIds ??
        handSettled.result.playerHands
          .filter((playerHand) => playerHand.cardsVisibility === 'shown')
          .map((playerHand) => playerHand.playerId),
    );

    const seats: CompletedHandHistorySeat[] = seatSnapshots.map((seat) => {
      const holeCardsVisibility =
        seat.playerId === requesterPlayerId
          ? 'self'
          : revealedPlayerIdSet.has(seat.playerId)
            ? 'revealed'
            : 'hidden';

      return {
        playerId: seat.playerId,
        playerName: seat.playerName,
        seatPosition: seat.position,
        positionLabel: seat.positionLabel ?? null,
        startingStack: seat.chips + seat.currentBet,
        holeCards:
          holeCardsVisibility === 'hidden' ? null : [...(seat.cards ?? [])],
        holeCardsVisibility,
      };
    });

    const communityCardsByStreet = {
      preFlop: [] as CompletedHandHistoryExport['communityCardsByStreet']['preFlop'],
      flop: [] as CompletedHandHistoryExport['communityCardsByStreet']['flop'],
      turn: [] as CompletedHandHistoryExport['communityCardsByStreet']['turn'],
      river: [] as CompletedHandHistoryExport['communityCardsByStreet']['river'],
    };

    const applyBoard = (
      board: PersistedBettingRoundAdvancedPayload['communityCards'],
    ) => {
      if (board.length >= 3) {
        communityCardsByStreet.flop = [...board.slice(0, 3)];
      }
      if (board.length >= 4) {
        communityCardsByStreet.turn = [...board.slice(0, 4)];
      }
      if (board.length >= 5) {
        communityCardsByStreet.river = [...board.slice(0, 5)];
      }
    };

    let runningPot = 0;
    const actions: CompletedHandHistoryAction[] = [];
    const pushAction = (
      action: Omit<CompletedHandHistoryAction, 'order'>,
    ) => {
      actions.push({
        order: actions.length + 1,
        ...action,
      });
      runningPot = action.potAfter;
    };

    const smallBlindSeat = seatSnapshots.find(
      (seat) => seat.position === handStarted.smallBlindPosition,
    );
    const bigBlindSeat = seatSnapshots.find(
      (seat) => seat.position === handStarted.bigBlindPosition,
    );

    if (smallBlindSeat && smallBlindSeat.currentBet > 0) {
      runningPot += smallBlindSeat.currentBet;
      pushAction({
        source: 'blind',
        street: 'PRE_FLOP',
        playerId: smallBlindSeat.playerId,
        playerName: smallBlindSeat.playerName,
        action: 'post-blind',
        amount: smallBlindSeat.currentBet,
        totalBetTo: smallBlindSeat.currentBet,
        potAfter: runningPot,
        blindType: 'SB',
        displayKind: 'blind',
      });
    }

    if (bigBlindSeat && bigBlindSeat.currentBet > 0) {
      runningPot += bigBlindSeat.currentBet;
      pushAction({
        source: 'blind',
        street: 'PRE_FLOP',
        playerId: bigBlindSeat.playerId,
        playerName: bigBlindSeat.playerName,
        action: 'post-blind',
        amount: bigBlindSeat.currentBet,
        totalBetTo: bigBlindSeat.currentBet,
        potAfter: runningPot,
        blindType: 'BB',
        displayKind: 'blind',
      });
    }

    for (const event of events) {
      if (event.type === 'BETTING_ROUND_ADVANCED') {
        const payload = event.payload as PersistedBettingRoundAdvancedPayload;
        applyBoard(payload.communityCards ?? []);
        continue;
      }

      if (event.type === 'PLAYER_ACTION') {
        const payload = event.payload as PersistedPlayerActionPayload;
        const result = payload.result;
        const playerId = event.actor?.playerId ?? '';
        const seat = seatSnapshotByPlayerId.get(playerId);
        pushAction({
          source: 'player',
          street: event.street ?? 'PRE_FLOP',
          playerId,
          playerName: event.actor?.playerName ?? seat?.playerName ?? '',
          action: result?.resolvedAction ?? payload.action,
          amount: result?.committedAmount ?? 0,
          totalBetTo: result?.totalBetAfterAction ?? null,
          potAfter: result?.potAfter ?? runningPot,
          blindType: null,
          displayKind: result?.displayKind ?? null,
        });
        continue;
      }

      if (event.type === 'SHOWDOWN_DECISION_UPDATED') {
        const payload = event.payload as {
          action?: 'REVEAL' | 'MUCK';
        };
        const playerId = event.actor?.playerId ?? '';
        const seat = seatSnapshotByPlayerId.get(playerId);
        if (payload.action === 'REVEAL' || payload.action === 'MUCK') {
          pushAction({
            source: 'player',
            street: event.street ?? 'SHOWDOWN',
            playerId,
            playerName: event.actor?.playerName ?? seat?.playerName ?? '',
            action: payload.action === 'REVEAL' ? 'reveal' : 'muck',
            amount: 0,
            totalBetTo: null,
            potAfter: runningPot,
            blindType: null,
            displayKind: null,
          });
        }
      }
    }

    if (communityCardsByStreet.river.length === 0) {
      const firstRunBoard = handSettled.result.runouts?.[0]?.board ?? [];
      applyBoard(firstRunBoard);
    }

    const settlement = {
      isShowdown: handSettled.isShowdown,
      revealedPlayerIds: [...(handSettled.revealedPlayerIds ?? [])],
      totalPot: handSettled.result.totalPot,
      payouts: [...(handSettled.result.payouts ?? [])],
      winners: [...(handSettled.result.winners ?? [])],
      netByPlayerId: { ...(handSettled.result.netByPlayerId ?? {}) },
    };

    for (const seat of seats) {
      const playerHand = playerHandByPlayerId.get(seat.playerId);
      if (
        seat.holeCardsVisibility === 'revealed' &&
        (!seat.holeCards || seat.holeCards.length === 0) &&
        playerHand?.cards?.length
      ) {
        seat.holeCards = [...playerHand.cards];
      }
    }

    return {
      version: 1,
      roomId,
      handNumber: handStarted.handNumber,
      requesterPlayerId,
      dealerPosition: handStarted.dealerPosition,
      smallBlindPosition: handStarted.smallBlindPosition,
      bigBlindPosition: handStarted.bigBlindPosition,
      blinds: {
        smallBlind: smallBlindSeat?.currentBet ?? 0,
        bigBlind: bigBlindSeat?.currentBet ?? 0,
      },
      communityCardsByStreet,
      seats,
      actions,
      settlement,
    };
  }

  async getCompletedGameHistory(
    roomId: string,
    requesterPlayerId: string,
  ): Promise<CompletedGameHistoryExport | null> {
    const room = await this.getRoom(roomId);
    if (!room || room.gameState !== 'ENDED') {
      return null;
    }

    const handRows = await this.db
      .select({ handNumber: handEventsTable.handNumber })
      .from(handEventsTable)
      .where(eq(handEventsTable.roomId, roomId))
      .groupBy(handEventsTable.handNumber)
      .orderBy(asc(handEventsTable.handNumber));

    const hands: CompletedHandHistoryExport[] = [];
    for (const row of handRows) {
      const handHistory = await this.getCompletedHandHistory(
        roomId,
        row.handNumber,
        requesterPlayerId,
      );
      if (handHistory) {
        hands.push(handHistory);
      }
    }

    if (hands.length === 0) {
      return null;
    }

    return {
      version: 1,
      roomId,
      requesterPlayerId,
      handCount: hands.length,
      hands,
    };
  }

  async archiveEndedRoom(
    roomId: string,
  ): Promise<{ archiveId: string } | null> {
    const archiveId = roomId;
    const existingArchive = await this.readSavedGameArchive(archiveId);
    if (existingArchive) {
      return { archiveId };
    }

    const room = await this.getRoom(roomId);
    if (!room || room.gameState !== 'ENDED') {
      return null;
    }

    const archivedPlayers = room.players as ArchivedRoomPlayer[];
    const participantViews = new Map<
      string,
      {
        requesterUserId: string;
        requesterPlayerId: string;
        hands: SavedGameDetail['hands'];
      }
    >();

    for (const player of archivedPlayers) {
      if (!player.userId) {
        continue;
      }

      const exportPayload = await this.getCompletedGameHistory(roomId, player.id);
      if (!exportPayload) {
        continue;
      }

      participantViews.set(player.userId, {
        requesterUserId: player.userId,
        requesterPlayerId: player.id,
        hands: exportPayload.hands.map((hand) => ({
          handNumber: hand.handNumber,
          history: hand,
          analysis: this.createPendingSavedGameAnalysis(room.lastActivityAt),
        })),
      });
    }

    if (participantViews.size === 0) {
      return null;
    }

    const startedAt = await this.resolveSavedGameStartedAt(roomId, room.createdAt);
    const concludedAt = Number(room.lastActivityAt || Date.now());
    const participants = archivedPlayers
      .map((player) => this.toSavedGameParticipant(player))
      .filter((participant) =>
        shouldIncludeArchivedRankingParticipant(participant),
      )
      .sort((left, right) => {
        if (right.finalChips !== left.finalChips) {
          return right.finalChips - left.finalChips;
        }
        if (right.profit !== left.profit) {
          return right.profit - left.profit;
        }
        return left.playerName.localeCompare(right.playerName);
      });
    const handCount = participantViews.values().next().value?.hands.length ?? 0;

    const archiveRecord: SavedGameArchiveRecord = {
      archiveId,
      roomId,
      createdAt: concludedAt,
      startedAt,
      concludedAt,
      handCount,
      blinds: {
        smallBlind: room.config.smallBlind,
        bigBlind: room.config.bigBlind,
      },
      participants,
      playerViews: Object.fromEntries(participantViews.entries()),
    };

    await this.db.transaction(async (tx) => {
      await this.lockArchive(tx, archiveId);

      const existingRows = await tx
        .select({ archiveId: savedGameArchivesTable.archiveId })
        .from(savedGameArchivesTable)
        .where(eq(savedGameArchivesTable.archiveId, archiveId))
        .limit(1);
      if (existingRows[0]) {
        return;
      }

      await tx.insert(savedGameArchivesTable).values({
        archiveId,
        roomId,
        createdAt: concludedAt,
        startedAt,
        concludedAt,
        handCount,
        record: archiveRecord as Record<string, unknown>,
      });

      for (const view of participantViews.values()) {
        await this.writeSavedGameIndexForUser(
          {
            archiveId,
            roomId,
            requesterUserId: view.requesterUserId,
            requesterPlayerId: view.requesterPlayerId,
            createdAt: concludedAt,
            startedAt,
            concludedAt,
            handCount,
            blinds: archiveRecord.blinds,
            participants,
          },
          tx,
        );
      }
    });

    return { archiveId };
  }

  async listSavedGamesForUser(userId: string): Promise<SavedGameSummary[]> {
    const rows = await this.db
      .select()
      .from(savedGameUserIndexesTable)
      .where(eq(savedGameUserIndexesTable.requesterUserId, userId))
      .orderBy(desc(savedGameUserIndexesTable.concludedAt));
    return rows.map((row) => row.summary);
  }

  async getSavedGameDetailForUser(
    archiveId: string,
    userId: string,
  ): Promise<SavedGameDetail | null> {
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    const playerView = archive.playerViews[userId];
    if (!playerView) {
      return null;
    }

    return {
      archiveId: archive.archiveId,
      roomId: archive.roomId,
      requesterUserId: userId,
      requesterPlayerId: playerView.requesterPlayerId,
      createdAt: archive.createdAt,
      startedAt: archive.startedAt,
      concludedAt: archive.concludedAt,
      handCount: archive.handCount,
      blinds: archive.blinds,
      participants: archive.participants,
      hands: playerView.hands.map((hand) => ({
        ...hand,
        analysis: this.normalizeSavedGameHandAnalysis(hand.analysis),
      })),
    };
  }

  async getSavedGameReviewTargets(
    archiveId: string,
  ): Promise<SavedGameReviewTargets | null> {
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    return {
      archiveId,
      playerViews: Object.values(archive.playerViews).map((view) => ({
        requesterUserId: view.requesterUserId,
        requesterPlayerId: view.requesterPlayerId,
        hands: view.hands.map((hand) => ({
          handNumber: hand.handNumber,
          history: hand.history,
        })),
      })),
    };
  }

  async updateSavedGameHandAnalysis(
    archiveId: string,
    userId: string,
    handNumber: number,
    analysis: SavedGameHandAnalysis,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockArchive(tx, archiveId);
      const archive = await this.readSavedGameArchive(archiveId, tx);
      if (!archive) {
        return;
      }

      const playerView = archive.playerViews[userId];
      if (!playerView) {
        return;
      }

      const nextHands = playerView.hands.map((hand) =>
        hand.handNumber === handNumber
          ? {
              ...hand,
              analysis: this.normalizeSavedGameHandAnalysis({
                ...analysis,
                updatedAt: Number(analysis.updatedAt || Date.now()),
              }),
            }
          : hand,
      );

      archive.playerViews[userId] = {
        ...playerView,
        hands: nextHands,
      };

      await tx
        .update(savedGameArchivesTable)
        .set({ record: archive as Record<string, unknown> })
        .where(eq(savedGameArchivesTable.archiveId, archiveId));
    });
  }

  async getSavedGameHandAnalysis(
    archiveId: string,
    userId: string,
    handNumber: number,
  ): Promise<SavedGameHandAnalysis | null> {
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    const playerView = archive.playerViews[userId];
    const hand = playerView?.hands.find((candidate) => candidate.handNumber === handNumber);
    return hand ? this.normalizeSavedGameHandAnalysis(hand.analysis) : null;
  }

  async mergeSavedGameHandLocalization(
    archiveId: string,
    userId: string,
    handNumber: number,
    locale: string,
    entry: NonNullable<SavedGameHandAnalysis['localizedByLocale']>[string],
  ): Promise<boolean> {
    let didMerge = false;

    await this.db.transaction(async (tx) => {
      await this.lockArchive(tx, archiveId);
      const archive = await this.readSavedGameArchive(archiveId, tx);
      if (!archive) {
        return;
      }

      const playerView = archive.playerViews[userId];
      if (!playerView) {
        return;
      }

      const nextHands = playerView.hands.map((hand) => {
        if (hand.handNumber !== handNumber) {
          return hand;
        }

        const normalizedAnalysis = this.normalizeSavedGameHandAnalysis(hand.analysis);
        didMerge = true;
        return {
          ...hand,
          analysis: {
            ...normalizedAnalysis,
            localizedByLocale: {
              ...(normalizedAnalysis.localizedByLocale ?? {}),
              [locale]: {
                ...entry,
                updatedAt: Number(entry.updatedAt || Date.now()),
                headline: entry.headline ?? null,
                summary: entry.summary ?? null,
                keyAdjustments: [...(entry.keyAdjustments ?? [])],
                failureReason: entry.failureReason ?? null,
              },
            },
          },
        };
      });

      if (!didMerge) {
        return;
      }

      archive.playerViews[userId] = {
        ...playerView,
        hands: nextHands,
      };

      await tx
        .update(savedGameArchivesTable)
        .set({ record: archive as Record<string, unknown> })
        .where(eq(savedGameArchivesTable.archiveId, archiveId));
    });

    return didMerge;
  }

  private async readProjection(
    roomId: string,
    executor: any = this.db,
  ): Promise<StoredRoomProjection | null> {
    const rows = await executor
      .select()
      .from(roomSnapshotsTable)
      .where(eq(roomSnapshotsTable.roomId, roomId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      snapshot: {
        lastRoomEventSeq: row.lastRoomEventSeq,
        updatedAt: row.updatedAt,
      },
      room: row.room,
    };
  }

  private async loadProjection(
    roomId: string,
    executor: any = this.db,
  ): Promise<StoredRoomProjection | null> {
    const projection = await this.readProjection(roomId, executor);
    if (projection?.room) {
      return projection;
    }
    return await this.rebuildProjectionFromLog(roomId, executor);
  }

  private async writeProjection(
    roomId: string,
    projection: StoredRoomProjection,
    executor: any = this.db,
  ): Promise<void> {
    await executor
      .insert(roomSnapshotsTable)
      .values({
        roomId,
        lastRoomEventSeq: projection.snapshot.lastRoomEventSeq,
        updatedAt: projection.snapshot.updatedAt,
        room: projection.room,
      })
      .onConflictDoUpdate({
        target: roomSnapshotsTable.roomId,
        set: {
          lastRoomEventSeq: projection.snapshot.lastRoomEventSeq,
          updatedAt: projection.snapshot.updatedAt,
          room: projection.room,
        },
      });
  }

  private async rebuildProjectionFromLog(
    roomId: string,
    executor: any = this.db,
  ): Promise<StoredRoomProjection | null> {
    const seqRows = await executor
      .select({ seq: roomEventsTable.seq })
      .from(roomEventsTable)
      .where(eq(roomEventsTable.roomId, roomId))
      .orderBy(desc(roomEventsTable.seq))
      .limit(1);
    const lastSeq = seqRows[0]?.seq ?? null;

    const latestRows = await executor
      .select({
        timestamp: roomEventsTable.timestamp,
        payload: roomEventsTable.payload,
        seq: roomEventsTable.seq,
      })
      .from(roomEventsTable)
      .where(
        and(
          eq(roomEventsTable.roomId, roomId),
          eq(roomEventsTable.type, 'ROOM_STATE_UPDATED'),
        ),
      )
      .orderBy(desc(roomEventsTable.seq))
      .limit(1);

    const latestSnapshot = latestRows[0];
    if (!latestSnapshot) {
      if (lastSeq !== null) {
        throw new Error(
          `Unable to rebuild room projection for ${roomId}: room history exists but no ROOM_STATE_UPDATED event was found.`,
        );
      }
      return null;
    }

    const room = (latestSnapshot.payload as { room?: Room }).room;
    if (!room) {
      throw new Error(
        `Unable to rebuild room projection for ${roomId}: ROOM_STATE_UPDATED seq ${latestSnapshot.seq} is missing payload.room.`,
      );
    }

    const projection: StoredRoomProjection = {
      snapshot: {
        lastRoomEventSeq: lastSeq ?? latestSnapshot.seq,
        updatedAt: latestSnapshot.timestamp,
      },
      room,
    };
    await this.writeProjection(roomId, projection, executor);
    return projection;
  }

  private createPendingSavedGameAnalysis(
    timestamp: number,
  ): SavedGameHandAnalysis {
    return {
      status: 'pending',
      updatedAt: Number(timestamp || Date.now()),
      provider: 'ai-robot-config',
      summary: null,
      headline: null,
      keyAdjustments: [],
      failureReason: null,
      localizedByLocale: {},
    };
  }

  private normalizeSavedGameHandAnalysis(
    analysis: SavedGameHandAnalysis,
  ): SavedGameHandAnalysis {
    return {
      ...analysis,
      updatedAt: Number(analysis.updatedAt || Date.now()),
      headline: analysis.headline ?? null,
      summary: analysis.summary ?? null,
      keyAdjustments: [...(analysis.keyAdjustments ?? [])],
      failureReason: analysis.failureReason ?? null,
      localizedByLocale: Object.fromEntries(
        Object.entries(analysis.localizedByLocale ?? {}).map(([locale, localized]) => [
          locale,
          {
            ...localized,
            updatedAt: Number(localized.updatedAt || analysis.updatedAt || Date.now()),
            headline: localized.headline ?? null,
            summary: localized.summary ?? null,
            keyAdjustments: [...(localized.keyAdjustments ?? [])],
            failureReason: localized.failureReason ?? null,
          },
        ]),
      ),
    };
  }

  private async resolveSavedGameStartedAt(
    roomId: string,
    fallback: number,
  ): Promise<number> {
    const rows = await this.db
      .select({ timestamp: roomEventsTable.timestamp })
      .from(roomEventsTable)
      .where(
        and(
          eq(roomEventsTable.roomId, roomId),
          eq(roomEventsTable.type, 'HAND_STARTED'),
        ),
      )
      .orderBy(asc(roomEventsTable.seq))
      .limit(1);
    return rows[0]?.timestamp ?? fallback;
  }

  private toSavedGameParticipant(player: ArchivedRoomPlayer): SavedGameParticipant {
    const finalChips = player.chips + (player.currentBet || 0);
    const totalBuyIn = player.totalBuyIn || 0;
    const handsPlayedCount = player.handsPlayedCount ?? 0;
    const vpipHandsCount = player.vpipHandsCount ?? 0;

    return {
      playerId: player.id,
      userId: player.userId ?? null,
      playerName: player.name,
      avatarEmoji: player.emoji ?? null,
      isRobot: Boolean(player.isRobot),
      finalChips,
      totalBuyIn,
      profit: finalChips - totalBuyIn,
      handsPlayedCount,
      handsWonCount: player.handsWonCount ?? 0,
      vpipHandsCount,
      vpipRate:
        handsPlayedCount > 0
          ? Number((vpipHandsCount / handsPlayedCount).toFixed(4))
          : 0,
    };
  }

  private async readSavedGameArchive(
    archiveId: string,
    executor: any = this.db,
  ): Promise<SavedGameArchiveRecord | null> {
    const rows = await executor
      .select({ record: savedGameArchivesTable.record })
      .from(savedGameArchivesTable)
      .where(eq(savedGameArchivesTable.archiveId, archiveId))
      .limit(1);
    return (rows[0]?.record as SavedGameArchiveRecord | undefined) ?? null;
  }

  private async writeSavedGameIndexForUser(
    summary: SavedGameSummary,
    executor: any = this.db,
  ): Promise<void> {
    await executor
      .insert(savedGameUserIndexesTable)
      .values({
        requesterUserId: summary.requesterUserId,
        archiveId: summary.archiveId,
        concludedAt: summary.concludedAt,
        summary,
      })
      .onConflictDoUpdate({
        target: [
          savedGameUserIndexesTable.requesterUserId,
          savedGameUserIndexesTable.archiveId,
        ],
        set: {
          concludedAt: summary.concludedAt,
          summary,
        },
      });
  }

  private async lockRoom(executor: any, roomId: string): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${roomId}))`,
    );
  }

  private async lockArchive(executor: any, archiveId: string): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${archiveId}))`,
    );
  }
}
