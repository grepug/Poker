import type { RejoinableRoomSummary } from "poker-types";
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

export const roomMembershipService = {
  listRejoinableRooms(): Promise<RejoinableRoomSummary[]> {
    return requestJson<RejoinableRoomSummary[]>("/api/rooms/rejoinable");
  },
};
