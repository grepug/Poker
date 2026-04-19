import type {
  SavedGameDetail,
  SavedGameHandAnalysis,
  SavedGameHandDetail,
  SavedGameReviewTargets,
  SavedGameSummary,
} from 'poker-types';

export interface ISavedGameArchiveStorageService {
  archiveEndedRoom(roomId: string): Promise<{ archiveId: string } | null>;
  listSavedGamesForUser(userId: string): Promise<SavedGameSummary[]>;
  getSavedGameDetailForUser(
    archiveId: string,
    userId: string,
  ): Promise<SavedGameDetail | null>;
  getSavedGameHandDetailForUser(
    archiveId: string,
    userId: string,
    handNumber: number,
  ): Promise<SavedGameHandDetail | null>;
  getSavedGameReviewTargets(
    archiveId: string,
  ): Promise<SavedGameReviewTargets | null>;
  getSavedGameHandAnalysis(
    archiveId: string,
    userId: string,
    handNumber: number,
  ): Promise<SavedGameHandAnalysis | null>;
  mergeSavedGameHandLocalization(
    archiveId: string,
    userId: string,
    handNumber: number,
    locale: string,
    entry: NonNullable<SavedGameHandAnalysis['localizedByLocale']>[string],
  ): Promise<boolean>;
  updateSavedGameHandAnalysis(
    archiveId: string,
    userId: string,
    handNumber: number,
    analysis: SavedGameHandAnalysis,
  ): Promise<void>;
}
