const LAST_PLAYER_NAME_STORAGE_KEY = "poker.lastPlayerName";
const LAST_PLAYER_EMOJI_STORAGE_KEY = "poker.lastPlayerEmoji";
const DEFAULT_PLAYER_EMOJI = "😀";

export function readLastPlayerName(): string {
  if (typeof window === "undefined") return "";

  try {
    const savedName = window.localStorage.getItem(LAST_PLAYER_NAME_STORAGE_KEY);
    return savedName?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeLastPlayerName(name: string): void {
  if (typeof window === "undefined") return;

  const trimmedName = name.trim();
  if (!trimmedName) return;

  try {
    window.localStorage.setItem(LAST_PLAYER_NAME_STORAGE_KEY, trimmedName);
  } catch {
    // Ignore write errors (for example private browsing storage restrictions).
  }
}

export function readLastPlayerEmoji(): string {
  if (typeof window === "undefined") return DEFAULT_PLAYER_EMOJI;

  try {
    const savedEmoji = window.localStorage.getItem(LAST_PLAYER_EMOJI_STORAGE_KEY);
    return savedEmoji?.trim() || DEFAULT_PLAYER_EMOJI;
  } catch {
    return DEFAULT_PLAYER_EMOJI;
  }
}

export function writeLastPlayerEmoji(emoji: string): void {
  if (typeof window === "undefined") return;

  const trimmedEmoji = emoji.trim();
  if (!trimmedEmoji) return;

  try {
    window.localStorage.setItem(LAST_PLAYER_EMOJI_STORAGE_KEY, trimmedEmoji);
  } catch {
    // Ignore write errors (for example private browsing storage restrictions).
  }
}
