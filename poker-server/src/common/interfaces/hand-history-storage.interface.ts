import type {
  CompletedGameHistoryExport,
  CompletedHandHistoryExport,
} from 'poker-types';

export interface IHandHistoryStorageService {
  getCompletedHandHistory(
    roomId: string,
    handNumber: number,
    requesterPlayerId: string,
  ): Promise<CompletedHandHistoryExport | null>;

  getCompletedGameHistory(
    roomId: string,
    requesterPlayerId: string,
  ): Promise<CompletedGameHistoryExport | null>;
}
