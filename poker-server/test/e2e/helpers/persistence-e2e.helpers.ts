import { expect, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PersistedRoomEventRecord, Room } from 'poker-types';

export const FRONTEND_URL =
  process.env.PW_FRONTEND_URL ??
  `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.PW_FRONTEND_PORT ?? '5174'}`;
export const BACKEND_URL =
  process.env.PW_BACKEND_URL ??
  `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.PW_BACKEND_PORT ?? '3001'}`;
const BACKEND_TARGET = new URL(BACKEND_URL);
const BACKEND_STORAGE_PORT =
  BACKEND_TARGET.port || (BACKEND_TARGET.protocol === 'https:' ? '443' : '80');

export const DEFAULT_BIG_BLIND = 10;
export const DEFAULT_OPENING_POT = 15;
export const DEFAULT_SMALL_BLIND_CALL_GAP = 5;
const DEFAULT_TEST_PASSWORD = 'test1234';
const ROOM_STATE_UPDATED_EVENT = 'ROOM_STATE_UPDATED';

export const E2E_DATA_DIR = path.resolve(
  process.cwd(),
  '.e2e-data',
  BACKEND_STORAGE_PORT,
);

export type PersistedRoomSnapshotMatch = {
  event: PersistedRoomEventRecord;
  room: Room;
  previousEvent: PersistedRoomEventRecord | null;
  previousSemanticEvent: PersistedRoomEventRecord | null;
};

type SessionCookie = {
  name: string;
  value: string;
};

export type TwoPlayerSession = {
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  alicePage: Page;
  bobPage: Page;
  roomCode: string;
};

type SetupTwoPlayerOptions = {
  roomConfig?: Record<string, unknown>;
  forceNonAutomationMode?: boolean;
};

export async function waitForPokerDebug(page: Page) {
  await page.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });
}

async function createBrowserContext(
  browser: any,
  forceNonAutomationMode = false,
) {
  const context = await browser.newContext();
  if (!forceNonAutomationMode) {
    return context;
  }

  await context.addInitScript(() => {
    try {
      Object.defineProperty(window.navigator, 'webdriver', {
        configurable: true,
        get: () => false,
      });
    } catch {
      // no-op fallback: test will still run in automation mode
    }
  });

  return context;
}

function extractSessionCookie(response: {
  headers(): Record<string, string>;
}): SessionCookie {
  const setCookieHeader = response.headers()['set-cookie'];
  const firstCookie = setCookieHeader?.split(',')[0]?.trim() ?? '';
  const cookiePair = firstCookie.split(';')[0]?.trim() ?? '';
  const equalsIndex = cookiePair.indexOf('=');

  if (equalsIndex <= 0) {
    throw new Error('Missing auth session cookie in login response');
  }

  const name = cookiePair.slice(0, equalsIndex).trim();
  const value = cookiePair.slice(equalsIndex + 1).trim();
  if (!name || !value) {
    throw new Error('Invalid auth session cookie in login response');
  }

  return { name, value };
}

async function ensureProfileForCurrentSession(
  page: Page,
  profile: { displayName: string; avatarEmoji?: string },
) {
  const response = await page
    .context()
    .request.patch(`${BACKEND_URL}/api/auth/me/profile`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        displayName: profile.displayName,
        avatarEmoji: profile.avatarEmoji ?? '🙂',
      },
    });
  if (!response.ok()) {
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
    };
    throw new Error(
      payload.message ||
        payload.error ||
        `profile update failed (${response.status()})`,
    );
  }
}

async function createRoomViaSocket(
  page: Page,
  playerName: string,
  config?: Record<string, unknown>,
) {
  await ensureProfileForCurrentSession(page, {
    displayName: playerName,
  });
  await waitForPokerDebug(page);
  await page.evaluate(
    async ({ requestedName, requestedConfig }) => {
      const socket = (window as any).pokerDebug?.getSocket?.();
      if (!socket) {
        throw new Error('Unable to create room: socket unavailable');
      }

      await new Promise<void>((resolve, reject) => {
        socket.emit(
          'CREATE_ROOM',
          { playerName: requestedName, config: requestedConfig },
          (response: { success?: boolean; error?: string }) => {
            if (response?.success) {
              resolve();
            } else {
              reject(
                new Error(response?.error || 'Unknown CREATE_ROOM failure'),
              );
            }
          },
        );
      });
    },
    { requestedName: playerName, requestedConfig: config },
  );

  await page.waitForSelector('[data-testid="room-title"]');
  const roomIdText = await page.textContent('[data-testid="room-title"]');
  const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
  if (!roomCode) {
    throw new Error('Failed to create room code');
  }

  return roomCode;
}

export async function authenticateTestUser(
  page: Page,
  accountId: string,
  profile: { displayName: string; avatarEmoji?: string },
) {
  const avatarEmoji = profile.avatarEmoji ?? '🙂';
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.context().clearCookies();

      const loginResponse = await page
        .context()
        .request.post(`${BACKEND_URL}/api/auth/password/login`, {
          headers: { 'Content-Type': 'application/json' },
          data: {
            accountId,
            password: DEFAULT_TEST_PASSWORD,
          },
        });
      const loginPayload = (await loginResponse.json()) as {
        user?: { id?: string };
        sessionExpiresAt?: number;
        message?: string;
        error?: string;
      };
      if (!loginResponse.ok() || !loginPayload.user?.id) {
        throw new Error(
          loginPayload.message ||
            loginPayload.error ||
            `login failed (${loginResponse.status()})`,
        );
      }

      const sessionCookie = extractSessionCookie(loginResponse);
      await page.context().addCookies([
        {
          url: BACKEND_URL,
          name: sessionCookie.name,
          value: sessionCookie.value,
          httpOnly: true,
          sameSite: 'Lax',
          secure: BACKEND_URL.startsWith('https://'),
          ...(typeof loginPayload.sessionExpiresAt === 'number'
            ? { expires: Math.floor(loginPayload.sessionExpiresAt / 1000) }
            : {}),
        },
      ]);

      const profileResponse = await page
        .context()
        .request.patch(`${BACKEND_URL}/api/auth/me/profile`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCookie.value}`,
          },
          data: {
            displayName: profile.displayName,
            avatarEmoji,
          },
        });
      if (!profileResponse.ok()) {
        const profilePayload = (await profileResponse.json()) as {
          message?: string;
          error?: string;
        };
        throw new Error(
          profilePayload.message ||
            profilePayload.error ||
            `profile update failed (${profileResponse.status()})`,
        );
      }

      await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
      const landingMode = await page
        .waitForFunction(
          () => {
            const pokerDebug = (window as any).pokerDebug;
            const room = pokerDebug?.getRoom?.();
            const player = pokerDebug?.getPlayer?.();
            const socket = pokerDebug?.getSocket?.();

            if (
              document.querySelector('[data-testid="room-title"]') &&
              room?.id &&
              player?.id
            ) {
              return 'room';
            }
            if (
              document.querySelector('[data-testid="connection-status"]') &&
              socket?.connected
            ) {
              return 'home';
            }
            return null;
          },
          { timeout: 10000 },
        )
        .then((handle) => handle.jsonValue() as Promise<'room' | 'home'>)
        .catch(async () => {
          const debugState = await page.evaluate(() => {
            const pokerDebug = (window as any).pokerDebug;
            const room = pokerDebug?.getRoom?.();
            const player = pokerDebug?.getPlayer?.();
            const socket = pokerDebug?.getSocket?.();
            return {
              hasAuthPage: Boolean(
                document.querySelector('[data-testid="auth-page"]'),
              ),
              hasConnectionStatus: Boolean(
                document.querySelector('[data-testid="connection-status"]'),
              ),
              hasRoomTitle: Boolean(
                document.querySelector('[data-testid="room-title"]'),
              ),
              socketConnected: Boolean(socket?.connected),
              roomId: room?.id ?? null,
              playerId: player?.id ?? null,
              path: window.location.pathname,
            };
          });
          if (debugState.hasAuthPage) {
            throw new Error('Frontend remained on auth page after login');
          }
          throw new Error(
            `Frontend did not reach authenticated landing after login: ${JSON.stringify(
              debugState,
            )}`,
          );
        });
      expect(['room', 'home']).toContain(landingMode);

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await page.goto('about:blank').catch(() => undefined);
      if (attempt < 3) {
        await page.waitForTimeout(250);
      }
    }
  }

  throw lastError ?? new Error('Authentication failed');
}

export async function setupTwoPlayerSession(
  browser: any,
  options?: SetupTwoPlayerOptions,
): Promise<TwoPlayerSession> {
  const aliceContext = await createBrowserContext(
    browser,
    options?.forceNonAutomationMode ?? false,
  );
  const bobContext = await createBrowserContext(
    browser,
    options?.forceNonAutomationMode ?? false,
  );
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await authenticateTestUser(alicePage, 'test1', {
    displayName: 'Alice',
    avatarEmoji: '🦊',
  });
  await authenticateTestUser(bobPage, 'test2', {
    displayName: 'Bob',
    avatarEmoji: '🐻',
  });

  const roomCode = options?.roomConfig
    ? await createRoomViaSocket(alicePage, 'Alice', options.roomConfig)
    : await createRoomViaSocket(alicePage, 'Alice');

  await bobPage.click('[data-testid="join-toggle-button"]');
  await bobPage.fill('[data-testid="name-input"]', 'Bob');
  await bobPage.fill('[data-testid="room-id-input"]', roomCode);
  await bobPage.click('[data-testid="join-room-button"]');

  await alicePage.waitForSelector(
    '[data-testid="room-player-count"]:has-text("Players: 2/")',
  );
  await bobPage.waitForSelector(
    '[data-testid="room-player-count"]:has-text("Players: 2/")',
  );

  return {
    aliceContext,
    bobContext,
    alicePage,
    bobPage,
    roomCode,
  };
}

export async function teardownTwoPlayerSession(session: TwoPlayerSession) {
  await Promise.allSettled([
    session.aliceContext.close(),
    session.bobContext.close(),
  ]);
}

async function updateAllowPlayerStreetReveal(page: Page, enabled: boolean) {
  await waitForPokerDebug(page);
  await page.evaluate(
    (nextValue) =>
      new Promise<void>((resolve, reject) => {
        const socket = (window as any).pokerDebug?.getSocket?.();
        if (!socket) {
          reject(new Error('socket unavailable'));
          return;
        }

        socket.emit(
          'UPDATE_ROOM_CONFIG',
          { config: { allowPlayerStreetReveal: nextValue } },
          (response: { success?: boolean; error?: string }) => {
            if (response?.success) {
              resolve();
            } else {
              reject(new Error(response?.error || 'UPDATE_ROOM_CONFIG failed'));
            }
          },
        );
      }),
    enabled,
  );
}

async function waitForAllowPlayerStreetReveal(
  page: Page,
  enabled: boolean,
  timeout = 5000,
) {
  await page.waitForFunction(
    (expected) =>
      (window as any).pokerDebug?.getRoom?.()?.config
        ?.allowPlayerStreetReveal === expected,
    enabled,
    { timeout },
  );
}

async function setAllowPlayerStreetRevealAndWait(
  hostPage: Page,
  participantPages: Page[],
  enabled: boolean,
) {
  await updateAllowPlayerStreetReveal(hostPage, enabled);
  await Promise.all(
    participantPages.map((page) =>
      waitForAllowPlayerStreetReveal(page, enabled),
    ),
  );
}

async function waitForHoleCards(page: Page, expectedCount = 2) {
  await page.waitForFunction(
    (count) => {
      const cards = (window as any).pokerDebug?.getCards?.();
      return Array.isArray(cards) && cards.length === count;
    },
    expectedCount,
    { timeout: 10000 },
  );
}

export async function startGameFromLobby(
  alicePage: Page,
  bobPage: Page,
  options?: { enableStreetReveal?: boolean },
) {
  const desiredStreetReveal = options?.enableStreetReveal ?? false;
  await setAllowPlayerStreetRevealAndWait(
    alicePage,
    [alicePage, bobPage],
    desiredStreetReveal,
  );
  await alicePage.click('[data-testid="start-game-button"]');
  await Promise.all([
    alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    }),
    bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
  ]);
  await Promise.all([waitForHoleCards(alicePage), waitForHoleCards(bobPage)]);
}

export async function waitForPlayerTurn(
  page: Page,
  playerName: string,
  timeoutMs = 10000,
) {
  await page.waitForFunction(
    (name) => {
      const room = (window as any).pokerDebug?.getRoom();
      const playerId = room?.players?.find((p: any) => p.name === name)?.id;
      return !!playerId && room?.currentHand?.currentPlayerTurn === playerId;
    },
    playerName,
    { timeout: timeoutMs },
  );
}

export async function getRoomSnapshot(page: Page) {
  return page.evaluate(() => {
    const room = (window as any).pokerDebug?.getRoom();
    const hand = room?.currentHand;
    const alice = room?.players?.find((p: any) => p.name === 'Alice');
    const bob = room?.players?.find((p: any) => p.name === 'Bob');
    return {
      handNumber: hand?.handNumber ?? 0,
      pot: hand?.pot ?? 0,
      currentBet: hand?.currentBet ?? 0,
      bettingRound: hand?.bettingRound ?? null,
      communityCards: hand?.communityCards?.length ?? 0,
      currentPlayerTurn: hand?.currentPlayerTurn ?? null,
      currentPlayerName:
        room?.players?.find((p: any) => p.id === hand?.currentPlayerTurn)
          ?.name ?? null,
      aliceChips: alice?.chips ?? 0,
      bobChips: bob?.chips ?? 0,
      aliceCurrentBet: alice?.currentBet ?? 0,
      bobCurrentBet: bob?.currentBet ?? 0,
    };
  });
}

export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function readJsonFileValue<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPersistedRoomEvents(
  roomId: string,
): Promise<PersistedRoomEventRecord[]> {
  const roomEventsPath = path.join(
    E2E_DATA_DIR,
    'rooms',
    roomId,
    'room-events.jsonl',
  );
  return readJsonlFile<PersistedRoomEventRecord>(roomEventsPath);
}

export async function waitForPersistedRoomSnapshot(
  roomId: string,
  predicate: (room: Room, event: PersistedRoomEventRecord) => boolean,
  timeoutMs = 10000,
): Promise<PersistedRoomSnapshotMatch> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const events = await readPersistedRoomEvents(roomId);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type !== ROOM_STATE_UPDATED_EVENT) {
          continue;
        }

        const room = (event.payload as { room?: Room }).room;
        if (!room) {
          continue;
        }

        if (predicate(room, event)) {
          let previousSemanticEvent: PersistedRoomEventRecord | null = null;
          for (
            let previousIndex = index - 1;
            previousIndex >= 0;
            previousIndex -= 1
          ) {
            const previousCandidate = events[previousIndex];
            if (previousCandidate.type !== ROOM_STATE_UPDATED_EVENT) {
              previousSemanticEvent = previousCandidate;
              break;
            }
          }

          return {
            event,
            room,
            previousEvent: index > 0 ? events[index - 1] ?? null : null,
            previousSemanticEvent,
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for persisted room snapshot for ${roomId}`);
}

export function buildChipRanking(room: Room) {
  return [...room.players]
    .sort(
      (left, right) => right.chips - left.chips || left.position - right.position,
    )
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      chips: player.chips,
      position: player.position,
    }));
}

export async function openChatPanel(page: Page) {
  await page.click('[data-testid="open-chat-button"]');
  await page.waitForSelector('[data-testid="chat-panel"]', {
    state: 'visible',
    timeout: 5000,
  });
}

export async function sendChatMessagesViaSocket(
  page: Page,
  messages: string[],
  prefix: string,
) {
  await waitForPokerDebug(page);
  await page.evaluate(
    async ({ outgoingMessages, idPrefix }) => {
      const socket = (window as any).pokerDebug?.getSocket?.();
      if (!socket) {
        throw new Error('Unable to send chat messages: socket unavailable');
      }

      const now = Date.now();
      await Promise.all(
        outgoingMessages.map(
          (text: string, index: number) =>
            new Promise<void>((resolve, reject) => {
              socket.emit(
                'SEND_CHAT_MESSAGE',
                {
                  kind: 'TEXT',
                  text,
                  clientMessageId: `${idPrefix}-${now}-${index}-${Math.random()
                    .toString(36)
                    .slice(2, 10)}`,
                },
                (response: { success?: boolean; error?: string }) => {
                  if (response?.success) {
                    resolve();
                    return;
                  }
                  reject(
                    new Error(
                      response?.error || 'Unknown SEND_CHAT_MESSAGE failure',
                    ),
                  );
                },
              );
            }),
        ),
      );
    },
    { outgoingMessages: messages, idPrefix: prefix },
  );
}

export async function getChatMessagesFromDebug(page: Page) {
  await waitForPokerDebug(page);
  return page.evaluate(
    () => (window as any).pokerDebug?.getChatMessages?.() ?? [],
  );
}

export async function waitForVoicePlaybackSource(
  page: Page,
  expectedSourceUrl: string,
  timeout = 10000,
) {
  await page.waitForFunction(
    (expected) =>
      (window as any).pokerDebug?.getVoicePlaybackState?.()?.sourceUrl ===
      expected,
    expectedSourceUrl,
    { timeout },
  );
}

export async function sendVoiceMessageViaUpload(page: Page, prefix: string) {
  await waitForPokerDebug(page);

  return page.evaluate(
    async ({ idPrefix }) => {
      const pokerDebug = (window as any).pokerDebug;
      const room = pokerDebug?.getRoom?.();
      const player = pokerDebug?.getPlayer?.();
      const socket = pokerDebug?.getSocket?.();

      if (!room?.id || !player?.id || !socket) {
        throw new Error(
          'Unable to send voice message: room/player/socket unavailable',
        );
      }

      const rawServerUrl =
        socket?.io?.uri ||
        (window as any).__POKER_SERVER_URL__ ||
        (window as any).__POKER_RUNTIME_CONFIG__?.serverUrl;
      if (!rawServerUrl) {
        throw new Error('Unable to resolve backend url for voice upload');
      }

      const serverBaseUrl = String(rawServerUrl).replace(/\/$/, '');
      const blob = new Blob(
        [
          new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56,
            0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00,
            0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02,
            0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
          ]),
        ],
        {
          type: 'audio/wav',
        },
      );

      const formData = new FormData();
      formData.append('audio', blob, 'test-audio.wav');
      formData.append('roomId', room.id);
      formData.append('playerId', player.id);
      formData.append('durationMs', '1200');

      const uploadResponse = await fetch(
        `${serverBaseUrl}/api/chat/voice-upload`,
        {
          method: 'POST',
          body: formData,
          credentials: 'include',
        },
      );

      const uploadPayload = await uploadResponse.json();
      if (
        !uploadResponse.ok ||
        !uploadPayload?.success ||
        !uploadPayload?.voice
      ) {
        throw new Error(uploadPayload?.error || 'Voice upload failed');
      }

      const clientMessageId = `${idPrefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

      await new Promise<void>((resolve, reject) => {
        socket.emit(
          'SEND_CHAT_MESSAGE',
          {
            kind: 'VOICE',
            voice: uploadPayload.voice,
            clientMessageId,
          },
          (response: { success?: boolean; error?: string }) => {
            if (response?.success) {
              resolve();
              return;
            }

            reject(
              new Error(
                response?.error || 'Failed to emit uploaded voice message',
              ),
            );
          },
        );
      });

      return {
        voice: uploadPayload.voice,
        serverBaseUrl,
      };
    },
    { idPrefix: prefix },
  );
}
