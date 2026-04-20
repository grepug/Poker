import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  PersistedRoomSnapshot,
  Room,
  RoomPersistedWrite,
  SavedGameDetail,
  SavedGameHandAnalysis,
  SavedGameHandDetail,
  SavedGameParticipant,
  SavedGameReviewTargets,
  SavedGameSummary,
  shouldIncludeArchivedRankingParticipant,
} from 'poker-types';
import { randomUUID } from 'crypto';
import { IStorageService } from '../common/interfaces/storage.interface';
import { IHandHistoryStorageService } from '../common/interfaces/hand-history-storage.interface';
import { ISavedGameArchiveStorageService } from '../common/interfaces/saved-game-archive-storage.interface';
import {
  appendJsonlRecords,
  ensureDir,
  pathExists,
  readFirstJsonlRecordMatching,
  readJsonFile,
  readJsonlRecords,
  writeJsonFileAtomic,
} from './jsonl-store.util';
import * as fs from 'fs/promises';
import * as path from 'path';

type StoredRoomProjection = {
  snapshot: PersistedRoomSnapshot;
  room: Room;
};

type ArchivedRoomPlayer = Room['players'][number] & {
  userId?: string;
  emoji?: string;
  isRobot?: boolean;
};

type SavedGameArchivePlayerView = {
  requesterUserId: string;
  requesterPlayerId: string;
  hands: SavedGameHandDetail[];
};

type SavedGameArchiveRecord = {
  archiveId: string;
  roomId: string;
  createdAt: number;
  startedAt: number;
  concludedAt: number;
  handCount: number;
  blinds: SavedGameSummary['blinds'];
  participants: SavedGameParticipant[];
  playerViews: Record<string, SavedGameArchivePlayerView>;
};

@Injectable()
export class JsonStorageService
  implements
    IStorageService,
    IHandHistoryStorageService,
    ISavedGameArchiveStorageService
{
  private readonly logger = new Logger(JsonStorageService.name);
  private readonly dataDir: string;
  private readonly roomsDir: string;
  private readonly savedGamesDir: string;
  private readonly savedGameArchivesDir: string;
  private readonly savedGameUserIndexesDir: string;
  private readonly roomWriteQueues: Map<string, Promise<void>> = new Map();
  private readonly savedGameArchiveWriteQueues: Map<string, Promise<void>> =
    new Map();

  constructor(private readonly configService: ConfigService) {
    this.dataDir = this.configService.get<string>('DATA_DIR') || './data';
    this.roomsDir = path.join(this.dataDir, 'rooms');
    this.savedGamesDir = path.join(this.dataDir, 'saved-games');
    this.savedGameArchivesDir = path.join(this.savedGamesDir, 'archives');
    this.savedGameUserIndexesDir = path.join(this.savedGamesDir, 'users');
    this.ensureDirectories().catch((err) =>
      this.logger.error(`Failed to initialize directories: ${err.message}`),
    );
  }

  async persistRoom(room: Room, write?: RoomPersistedWrite): Promise<void> {
    return this.runRoomWriteSequentially(room.id, async () => {
      try {
        await this.ensureDirectories();
        await this.migrateLegacyRoomIfNeeded(room.id);

        const currentProjection = await this.loadProjection(room.id);
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

        await appendJsonlRecords(this.getRoomEventsPath(room.id), roomEvents);
        await this.appendHandEvents(room.id, roomEvents);
        await this.writeProjection(room.id, {
          snapshot: {
            lastRoomEventSeq: nextSeq,
            updatedAt: timestamp,
          },
          room,
        });
        this.logger.debug(`Room ${room.id} persisted via JSONL storage`);
      } catch (error) {
        this.logger.error(
          `Failed to persist room ${room.id}: ${(error as Error).message}`,
        );
        throw new Error(`Failed to persist room: ${(error as Error).message}`);
      }
    });
  }

  async getRoom(roomId: string): Promise<Room | null> {
    try {
      await this.ensureDirectories();
      await this.migrateLegacyRoomIfNeeded(roomId);

      const projection = await this.loadProjection(roomId);
      if (projection?.room) {
        return projection.room;
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve room ${roomId}: ${(error as Error).message}`,
      );
      throw new Error(`Failed to retrieve room: ${(error as Error).message}`);
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    try {
      await fs.rm(this.getRoomDir(roomId), { recursive: true, force: true });
      await fs.rm(this.getLegacyRoomFilePath(roomId), { force: true });
      this.logger.log(`Room ${roomId} deleted from JSONL storage`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      this.logger.error(
        `Failed to delete room ${roomId}: ${(error as Error).message}`,
      );
      throw new Error(`Failed to delete room: ${(error as Error).message}`);
    }
  }

  async getAllRooms(): Promise<Room[]> {
    try {
      await this.ensureDirectories();
      await this.migrateLegacyRoomsInDirectory();

      const entries = await fs.readdir(this.roomsDir, { withFileTypes: true });
      const rooms: Room[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        try {
          const room = await this.getRoom(entry.name);
          if (room) {
            rooms.push(room);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to parse room ${entry.name}: ${(error as Error).message}`,
          );
        }
      }

      return rooms;
    } catch (error) {
      this.logger.error(`Failed to get all rooms: ${(error as Error).message}`);
      throw new Error(`Failed to get all rooms: ${(error as Error).message}`);
    }
  }

  async roomExists(roomId: string): Promise<boolean> {
    return Boolean(await this.getRoom(roomId));
  }

  async getCompletedHandHistory(
    roomId: string,
    handNumber: number,
    requesterPlayerId: string,
  ): Promise<CompletedHandHistoryExport | null> {
    await this.ensureDirectories();

    const events = await readJsonlRecords<PersistedRoomEventRecord>(
      this.getHandEventsPath(roomId, handNumber),
    );
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

    // Preserve deterministic seat ordering even when the settled result omits cards.
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
      dealtPlayerIds: [...(handStarted.dealtPlayerIds ?? [])],
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
    await this.ensureDirectories();

    const room = await this.getRoom(roomId);
    if (!room || room.gameState !== 'ENDED') {
      return null;
    }

    const handsDir = this.getHandsDir(roomId);
    if (!(await pathExists(handsDir))) {
      return null;
    }

    const handEntries = await fs.readdir(handsDir, { withFileTypes: true });
    const handNumbers = handEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => Number.parseInt(entry.name.replace(/\.jsonl$/, ''), 10))
      .filter((handNumber) => Number.isFinite(handNumber))
      .sort((left, right) => left - right);

    const hands: CompletedHandHistoryExport[] = [];
    for (const handNumber of handNumbers) {
      const handHistory = await this.getCompletedHandHistory(
        roomId,
        handNumber,
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
    return this.runSavedGameArchiveWriteSequentially(archiveId, async () => {
      await this.ensureDirectories();

      const existingArchive = await this.readSavedGameArchive(archiveId);
      if (existingArchive) {
        return { archiveId };
      }

      const room = await this.getRoom(roomId);
      if (!room || room.gameState !== 'ENDED') {
        return null;
      }

      const archivedPlayers = room.players as ArchivedRoomPlayer[];
      const participantViews = new Map<string, SavedGameArchivePlayerView>();

      for (const player of archivedPlayers) {
        if (!player.userId) {
          continue;
        }

        const exportPayload = await this.getCompletedGameHistory(
          roomId,
          player.id,
        );
        if (!exportPayload) {
          continue;
        }

        const normalizedHands = this.filterSavedGameHandsForRequester(
          exportPayload.hands.map((hand) => ({
            handNumber: hand.handNumber,
            history: hand,
            analysis: this.createPendingSavedGameAnalysis(room.lastActivityAt),
          })),
          player.id,
        );
        if (normalizedHands.length === 0) {
          continue;
        }

        participantViews.set(player.userId, {
          requesterUserId: player.userId,
          requesterPlayerId: player.id,
          hands: normalizedHands,
        });
      }

      if (participantViews.size === 0) {
        return null;
      }

      const startedAt = await this.resolveSavedGameStartedAt(
        roomId,
        room.createdAt,
      );
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
      const handCount = Array.from(participantViews.values()).reduce(
        (max, view) => Math.max(max, view.hands.length),
        0,
      );

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

      await writeJsonFileAtomic(
        this.getSavedGameArchivePath(archiveId),
        archiveRecord,
      );

      await Promise.all(
        Array.from(participantViews.values()).map((view) =>
          this.writeSavedGameIndexForUser(
            this.buildSavedGameSummary(archiveRecord, view),
          ),
        ),
      );

      return { archiveId };
    });
  }

  async listSavedGamesForUser(userId: string): Promise<SavedGameSummary[]> {
    await this.ensureDirectories();
    const savedGames =
      (await readJsonFile<SavedGameSummary[]>(
        this.getSavedGameUserIndexPath(userId),
      )) ?? [];

    const normalizedSummaries = await Promise.all(
      savedGames.map(async (summary) => {
        const archive = await this.readSavedGameArchive(summary.archiveId);
        if (!archive) {
          return {
            ...summary,
            participants: this.normalizeSavedGameParticipants(summary.participants),
          };
        }

        const playerView = this.getNormalizedSavedGamePlayerView(
          archive.playerViews[userId],
        );
        if (!playerView) {
          return null;
        }

        return this.buildSavedGameSummary(archive, playerView);
      }),
    );

    return normalizedSummaries.filter(
      (summary): summary is SavedGameSummary => Boolean(summary),
    );
  }

  async getSavedGameDetailForUser(
    archiveId: string,
    userId: string,
  ): Promise<SavedGameDetail | null> {
    await this.ensureDirectories();
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    const playerView = this.getNormalizedSavedGamePlayerView(
      archive.playerViews[userId],
    );
    if (!playerView) {
      return null;
    }

    const participants = this.normalizeSavedGameParticipants(
      archive.participants,
    );

    return {
      archiveId: archive.archiveId,
      roomId: archive.roomId,
      requesterUserId: userId,
      requesterPlayerId: playerView.requesterPlayerId,
      createdAt: archive.createdAt,
      startedAt: archive.startedAt,
      concludedAt: archive.concludedAt,
      handCount: playerView.hands.length,
      blinds: archive.blinds,
      participants,
      hands: playerView.hands.map((hand) => ({
        handNumber: hand.handNumber,
        totalPot: hand.history.settlement.totalPot,
        actionCount: hand.history.actions.length,
        analysis: this.normalizeSavedGameHandAnalysis(hand.analysis),
      })),
    };
  }

  async getSavedGameHandDetailForUser(
    archiveId: string,
    userId: string,
    handNumber: number,
  ): Promise<SavedGameHandDetail | null> {
    await this.ensureDirectories();
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    const playerView = this.getNormalizedSavedGamePlayerView(
      archive.playerViews[userId],
    );
    const hand = playerView?.hands.find(
      (candidate) => candidate.handNumber === handNumber,
    );
    if (!hand) {
      return null;
    }

    return {
      handNumber: hand.handNumber,
      history: hand.history,
      analysis: this.normalizeSavedGameHandAnalysis(hand.analysis),
    };
  }

  async getSavedGameReviewTargets(
    archiveId: string,
  ): Promise<SavedGameReviewTargets | null> {
    await this.ensureDirectories();
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    return {
      archiveId,
      playerViews: Object.values(archive.playerViews)
        .map((view) => this.getNormalizedSavedGamePlayerView(view))
        .filter((view): view is SavedGameArchivePlayerView => Boolean(view))
        .map((view) => ({
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
    await this.runSavedGameArchiveWriteSequentially(archiveId, async () => {
      await this.ensureDirectories();
      const archive = await this.readSavedGameArchive(archiveId);
      if (!archive) {
        return;
      }

      const playerView = this.getNormalizedSavedGamePlayerView(
        archive.playerViews[userId],
      );
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
      await writeJsonFileAtomic(this.getSavedGameArchivePath(archiveId), archive);
    });
  }

  async getSavedGameHandAnalysis(
    archiveId: string,
    userId: string,
    handNumber: number,
  ): Promise<SavedGameHandAnalysis | null> {
    await this.ensureDirectories();
    const archive = await this.readSavedGameArchive(archiveId);
    if (!archive) {
      return null;
    }

    const playerView = this.getNormalizedSavedGamePlayerView(
      archive.playerViews[userId],
    );
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

    await this.runSavedGameArchiveWriteSequentially(archiveId, async () => {
      await this.ensureDirectories();
      const archive = await this.readSavedGameArchive(archiveId);
      if (!archive) {
        return;
      }

      const playerView = this.getNormalizedSavedGamePlayerView(
        archive.playerViews[userId],
      );
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
      await writeJsonFileAtomic(this.getSavedGameArchivePath(archiveId), archive);
    });

    return didMerge;
  }

  private async ensureDirectories(): Promise<void> {
    await ensureDir(this.roomsDir);
    await ensureDir(this.savedGameArchivesDir);
    await ensureDir(this.savedGameUserIndexesDir);
  }

  private getLegacyRoomFilePath(roomId: string): string {
    return path.join(this.roomsDir, `${roomId}.json`);
  }

  private getRoomDir(roomId: string): string {
    return path.join(this.roomsDir, roomId);
  }

  private getRoomEventsPath(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'room-events.jsonl');
  }

  private getHandsDir(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'hands');
  }

  private getHandEventsPath(roomId: string, handNumber: number): string {
    return path.join(this.getHandsDir(roomId), `${handNumber}.jsonl`);
  }

  private getProjectionPath(roomId: string): string {
    return path.join(this.getRoomDir(roomId), 'room.snapshot.json');
  }

  private getSavedGameArchivePath(archiveId: string): string {
    return path.join(this.savedGameArchivesDir, `${archiveId}.json`);
  }

  private getSavedGameUserIndexPath(userId: string): string {
    return path.join(this.savedGameUserIndexesDir, `${userId}.json`);
  }

  private async readProjection(roomId: string): Promise<StoredRoomProjection | null> {
    return await readJsonFile<StoredRoomProjection>(this.getProjectionPath(roomId));
  }

  private async loadProjection(
    roomId: string,
  ): Promise<StoredRoomProjection | null> {
    try {
      const projection = await this.readProjection(roomId);
      if (projection?.room) {
        return projection;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read room projection ${roomId}, rebuilding from log: ${(error as Error).message}`,
      );
    }

    return await this.rebuildProjectionFromLog(roomId);
  }

  private async writeProjection(
    roomId: string,
    projection: StoredRoomProjection,
  ): Promise<void> {
    await writeJsonFileAtomic(this.getProjectionPath(roomId), projection);
  }

  private async appendHandEvents(
    roomId: string,
    roomEvents: PersistedRoomEventRecord[],
  ): Promise<void> {
    const eventsByHandNumber = new Map<number, PersistedRoomEventRecord[]>();

    for (const event of roomEvents) {
      if (!event.handNumber || event.type === 'ROOM_STATE_UPDATED') {
        continue;
      }

      const records = eventsByHandNumber.get(event.handNumber) ?? [];
      records.push(event);
      eventsByHandNumber.set(event.handNumber, records);
    }

    await Promise.all(
      Array.from(eventsByHandNumber.entries()).map(([handNumber, records]) =>
        appendJsonlRecords(this.getHandEventsPath(roomId, handNumber), records),
      ),
    );
  }

  private async rebuildProjectionFromLog(
    roomId: string,
  ): Promise<StoredRoomProjection | null> {
    const events = await readJsonlRecords<PersistedRoomEventRecord>(
      this.getRoomEventsPath(roomId),
    );
    if (events.length === 0) {
      return null;
    }

    const latestSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'ROOM_STATE_UPDATED');
    const room = latestSnapshot?.payload.room as Room | undefined;
    if (!room) {
      return null;
    }

    const projection: StoredRoomProjection = {
      snapshot: {
        lastRoomEventSeq: events[events.length - 1].seq,
        updatedAt: latestSnapshot.timestamp,
      },
      room,
    };
    await this.writeProjection(roomId, projection);
    return projection;
  }

  private async runRoomWriteSequentially<T>(
    roomId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousQueue = this.roomWriteQueues.get(roomId) || Promise.resolve();
    let releaseCurrent: () => void = () => {};

    const gate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const nextQueue = previousQueue.finally(() => gate);
    this.roomWriteQueues.set(roomId, nextQueue);

    await previousQueue.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.roomWriteQueues.get(roomId) === nextQueue) {
        this.roomWriteQueues.delete(roomId);
      }
    }
  }

  private async runSavedGameArchiveWriteSequentially<T>(
    archiveId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousQueue =
      this.savedGameArchiveWriteQueues.get(archiveId) || Promise.resolve();
    let releaseCurrent: () => void = () => {};

    const gate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const nextQueue = previousQueue.finally(() => gate);
    this.savedGameArchiveWriteQueues.set(archiveId, nextQueue);

    await previousQueue.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.savedGameArchiveWriteQueues.get(archiveId) === nextQueue) {
        this.savedGameArchiveWriteQueues.delete(archiveId);
      }
    }
  }

  private async migrateLegacyRoomsInDirectory(): Promise<void> {
    const entries = await fs.readdir(this.roomsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      await this.migrateLegacyRoomIfNeeded(entry.name.replace(/\.json$/, ''));
    }
  }

  private async migrateLegacyRoomIfNeeded(roomId: string): Promise<void> {
    const legacyPath = this.getLegacyRoomFilePath(roomId);
    const hasLegacy = await pathExists(legacyPath);
    const hasProjection = await pathExists(this.getProjectionPath(roomId));
    const hasLog = await pathExists(this.getRoomEventsPath(roomId));
    if (!hasLegacy) {
      return;
    }

    if (hasProjection || hasLog) {
      const cleanedUp = await this.cleanupLegacyRoomIfJsonlReady(
        roomId,
        legacyPath,
        hasProjection,
        hasLog,
      );
      if (!cleanedUp) {
        this.logger.warn(
          `Skipping legacy room migration for ${roomId} because the JSONL layout is only partially present`,
        );
      }
      return;
    }

    let legacyRoom: Room | null;
    try {
      legacyRoom = await readJsonFile<Room>(legacyPath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.logger.warn(
          `Skipping malformed legacy room snapshot ${roomId}: ${error.message}`,
        );
        return;
      }
      throw error;
    }

    if (!legacyRoom) {
      return;
    }

    const migratedAt = Number(
      legacyRoom.lastActivityAt || legacyRoom.createdAt || Date.now(),
    );
    const migrationEvents: PersistedRoomEventRecord[] = [
      {
        recordId: randomUUID(),
        seq: 1,
        roomId,
        handNumber: legacyRoom.currentHand?.handNumber ?? null,
        street: legacyRoom.currentHand?.bettingRound ?? null,
        timestamp: migratedAt,
        type: 'ROOM_MIGRATED',
        actor: { source: 'MIGRATION' },
        payload: {
          legacyPath,
        },
      },
      {
        recordId: randomUUID(),
        seq: 2,
        roomId,
        handNumber: legacyRoom.currentHand?.handNumber ?? null,
        street: legacyRoom.currentHand?.bettingRound ?? null,
        timestamp: migratedAt,
        type: 'ROOM_STATE_UPDATED',
        actor: { source: 'MIGRATION' },
        payload: {
          room: legacyRoom,
        },
      },
    ];

    await appendJsonlRecords(this.getRoomEventsPath(roomId), migrationEvents);
    await this.appendHandEvents(roomId, migrationEvents);
    await this.writeProjection(roomId, {
      snapshot: {
        lastRoomEventSeq: 2,
        updatedAt: migratedAt,
      },
      room: legacyRoom,
    });
    await fs.rm(legacyPath, { force: true });
    this.logger.log(`Migrated legacy room snapshot ${roomId} to JSONL layout`);
  }

  private async cleanupLegacyRoomIfJsonlReady(
    roomId: string,
    legacyPath: string,
    hasProjection: boolean,
    hasLog: boolean,
  ): Promise<boolean> {
    if (!hasLog) {
      return false;
    }

    await readJsonlRecords<PersistedRoomEventRecord>(this.getRoomEventsPath(roomId));
    if (hasProjection) {
      try {
        await readJsonFile<StoredRoomProjection>(this.getProjectionPath(roomId));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Projection for room ${roomId} is unreadable during legacy cleanup; rebuilding from room log: ${message}`,
        );
        await this.rebuildProjectionFromLog(roomId);
      }
    } else {
      await this.rebuildProjectionFromLog(roomId);
    }

    await fs.rm(legacyPath, { force: true });
    this.logger.log(`Removed legacy room snapshot ${roomId} after confirming JSONL layout`);
    return true;
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
    const firstHandStarted =
      await readFirstJsonlRecordMatching<PersistedRoomEventRecord>(
        this.getRoomEventsPath(roomId),
        (event) => event.type === 'HAND_STARTED',
      );
    return firstHandStarted?.timestamp ?? fallback;
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

  private normalizeSavedGameParticipants(
    participants: SavedGameParticipant[],
  ): SavedGameParticipant[] {
    return participants.filter((participant) =>
      shouldIncludeArchivedRankingParticipant(participant),
    );
  }

  private filterSavedGameHandsForRequester(
    hands: SavedGameHandDetail[],
    requesterPlayerId: string,
  ): SavedGameHandDetail[] {
    return hands.filter((hand) =>
      this.didRequesterParticipateInHand(hand.history, requesterPlayerId),
    );
  }

  private didRequesterParticipateInHand(
    handHistory: CompletedHandHistoryExport,
    requesterPlayerId: string,
  ): boolean {
    const dealtPlayerIds = handHistory.dealtPlayerIds;
    if (Array.isArray(dealtPlayerIds) && dealtPlayerIds.length > 0) {
      return dealtPlayerIds.includes(requesterPlayerId);
    }

    const requesterSeat = handHistory.seats.find(
      (seat) => seat.playerId === requesterPlayerId,
    );
    if (!requesterSeat) {
      return false;
    }

    if (requesterSeat.positionLabel) {
      return true;
    }

    if ((requesterSeat.holeCards ?? []).length > 0) {
      return true;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        handHistory.settlement.netByPlayerId,
        requesterPlayerId,
      )
    ) {
      return true;
    }

    return handHistory.actions.some(
      (action) => action.playerId === requesterPlayerId,
    );
  }

  private getNormalizedSavedGamePlayerView(
    view?: SavedGameArchivePlayerView,
  ): SavedGameArchivePlayerView | null {
    if (!view) {
      return null;
    }

    const hands = this.filterSavedGameHandsForRequester(
      view.hands,
      view.requesterPlayerId,
    );
    if (hands.length === 0) {
      return null;
    }

    return {
      ...view,
      hands,
    };
  }

  private buildSavedGameSummary(
    archive: Pick<
      SavedGameArchiveRecord,
      | 'archiveId'
      | 'roomId'
      | 'createdAt'
      | 'startedAt'
      | 'concludedAt'
      | 'blinds'
      | 'participants'
    >,
    playerView: SavedGameArchivePlayerView,
  ): SavedGameSummary {
    return {
      archiveId: archive.archiveId,
      roomId: archive.roomId,
      requesterUserId: playerView.requesterUserId,
      requesterPlayerId: playerView.requesterPlayerId,
      createdAt: archive.createdAt,
      startedAt: archive.startedAt,
      concludedAt: archive.concludedAt,
      handCount: playerView.hands.length,
      blinds: archive.blinds,
      participants: this.normalizeSavedGameParticipants(archive.participants),
    };
  }

  private async readSavedGameArchive(
    archiveId: string,
  ): Promise<SavedGameArchiveRecord | null> {
    return await readJsonFile<SavedGameArchiveRecord>(
      this.getSavedGameArchivePath(archiveId),
    );
  }

  private async writeSavedGameIndexForUser(
    summary: SavedGameSummary,
  ): Promise<void> {
    const current =
      (await readJsonFile<SavedGameSummary[]>(
        this.getSavedGameUserIndexPath(summary.requesterUserId),
      )) ?? [];
    const next = [...current.filter((item) => item.archiveId !== summary.archiveId), summary]
      .sort((left, right) => right.concludedAt - left.concludedAt);
    await writeJsonFileAtomic(
      this.getSavedGameUserIndexPath(summary.requesterUserId),
      next,
    );
  }
}
