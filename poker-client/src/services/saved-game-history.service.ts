import type {
  SavedGameDetail,
  SavedGameHandDetail,
  SavedGameSummary,
} from "poker-types";
import { resolveServerResourceUrl } from "./socket.service";

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(resolveServerResourceUrl(path), {
    method: "GET",
    credentials: "include",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }

  return payload as T;
}

export const savedGameHistoryService = {
  listSavedGames(): Promise<SavedGameSummary[]> {
    return requestJson<SavedGameSummary[]>("/api/history/games");
  },

  getSavedGameDetail(archiveId: string, locale: string): Promise<SavedGameDetail> {
    const query = new URLSearchParams({ locale });
    return requestJson<SavedGameDetail>(
      `/api/history/games/${archiveId}?${query.toString()}`,
    );
  },

  getSavedGameHandDetail(
    archiveId: string,
    handNumber: number,
    locale: string,
  ): Promise<SavedGameHandDetail> {
    const query = new URLSearchParams({ locale });
    return requestJson<SavedGameHandDetail>(
      `/api/history/games/${archiveId}/hands/${handNumber}?${query.toString()}`,
    );
  },
};
