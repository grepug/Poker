import type {
  CompletedGameHistoryExport,
  CompletedHandHistoryExport,
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

export const handHistoryService = {
  getCompletedHandHistory(
    roomId: string,
    handNumber: number,
  ): Promise<CompletedHandHistoryExport> {
    return requestJson<CompletedHandHistoryExport>(
      `/api/rooms/${roomId}/hands/${handNumber}/history`,
    );
  },

  getCompletedGameHistory(roomId: string): Promise<CompletedGameHistoryExport> {
    return requestJson<CompletedGameHistoryExport>(`/api/rooms/${roomId}/history`);
  },
};
