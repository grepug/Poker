const LAST_PLAYER_NAME_STORAGE_KEY = "poker.lastPlayerName";

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
