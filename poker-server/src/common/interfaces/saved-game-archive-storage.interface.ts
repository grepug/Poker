import type {
  SavedGameDetail,
  SavedGameHandAnalysis,
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
  getSavedGameReviewTargets(
    archiveId: string,
  ): Promise<SavedGameReviewTargets | null>;
  updateSavedGameHandAnalysis(
    archiveId: string,
    userId: string,
    handNumber: number,
    analysis: SavedGameHandAnalysis,
  ): Promise<void>;
}
