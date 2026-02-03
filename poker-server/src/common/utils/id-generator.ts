import { customAlphabet } from 'nanoid';

// Generate short alphanumeric room IDs (e.g., "AB12CD")
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/**
 * Generate a unique room ID
 * Format: 6 alphanumeric characters (excluding confusing chars like 0, O, I, 1)
 */
export function generateRoomId(): string {
  return nanoid();
}

/**
 * Generate a unique player ID
 * Using UUID v4
 */
export function generatePlayerId(): string {
  return crypto.randomUUID();
}
