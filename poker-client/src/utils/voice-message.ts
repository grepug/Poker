import { resolveServerResourceUrl } from "../services/socket.service";

export const normalizeVoiceDurationSeconds = (durationMs: number): number => {
  if (!Number.isFinite(durationMs)) {
    return 1;
  }

  const roundedSeconds = Math.round(durationMs / 1000);
  return Math.max(1, Math.min(60, roundedSeconds));
};

export const formatVoiceDurationPrime = (durationMs: number): string =>
  `${normalizeVoiceDurationSeconds(durationMs)}'`;

export const computeVoiceBubbleWidthPx = (durationMs: number): number => {
  const minWidth = 50;
  const maxWidth = 220;
  const seconds = normalizeVoiceDurationSeconds(durationMs);
  const ratio = (seconds - 1) / 59;
  const easedRatio = Math.pow(ratio, 0.72);
  return Math.round(minWidth + (maxWidth - minWidth) * easedRatio);
};

export const resolveVoiceAudioUrl = (audioUrl: string): string =>
  resolveServerResourceUrl(audioUrl);
