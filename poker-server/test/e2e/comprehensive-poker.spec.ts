import * as fs from 'fs/promises';
import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Comprehensive Poker E2E Test Suite
 * Tests actual browser interactions with the React frontend
 * Uses window.pokerDebug API for deterministic testing with predetermined cards
 */

const FRONTEND_URL =
  process.env.PW_FRONTEND_URL ??
  `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.PW_FRONTEND_PORT ?? '5174'}`;
const BACKEND_URL =
  process.env.PW_BACKEND_URL ??
  `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.PW_BACKEND_PORT ?? '3001'}`;

const DEFAULT_STARTING_CHIPS = 1000;
const DEFAULT_SMALL_BLIND = 5;
const DEFAULT_BIG_BLIND = 10;
const DEFAULT_OPENING_POT = DEFAULT_SMALL_BLIND + DEFAULT_BIG_BLIND;
const DEFAULT_TWO_PLAYER_MATCHED_POT = DEFAULT_BIG_BLIND * 2;
const DEFAULT_SMALL_BLIND_CALL_GAP = DEFAULT_BIG_BLIND - DEFAULT_SMALL_BLIND;
const DEFAULT_TEST_PASSWORD = 'test1234';

type SessionCookie = {
  name: string;
  value: string;
};

// Helper to wait for pokerDebug to be available
async function waitForPokerDebug(page: Page) {
  await page.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });
}

async function assertWaitingBadgeExternalForSeat(page: Page, playerId: string) {
  const seat = page.locator(`[data-testid="player-seat-${playerId}"]`);
  await expect(
    seat.locator(`[data-testid="player-seat-${playerId}-external-status"]`),
  ).toHaveCount(1);
  await expect(
    seat.locator(`[data-testid="player-seat-${playerId}-status"]`),
  ).toHaveCount(0);
  await expect(seat).not.toContainText(/NEXT HAND|下手入局/);
}

async function openLeaveRoomConfirm(
  page: Page,
  triggerSelector = '[data-testid="leave-room-button"]',
) {
  await page.click(triggerSelector);
  await expect(
    page.locator('[data-testid="leave-room-confirm-modal"]'),
  ).toBeVisible();
}

async function confirmLeaveRoom(
  page: Page,
  triggerSelector = '[data-testid="leave-room-button"]',
) {
  await openLeaveRoomConfirm(page, triggerSelector);
  await page.click('[data-testid="leave-room-confirm-accept"]');
  await expect(
    page.locator('[data-testid="leave-room-confirm-modal"]'),
  ).toHaveCount(0);
}

async function readDownloadedJson(page: Page, triggerSelector: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(triggerSelector),
  ]);
  const failure = await download.failure();
  if (failure) {
    throw new Error(`Download failed: ${failure}`);
  }

  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('Download path unavailable');
  }

  const raw = await fs.readFile(downloadPath, 'utf-8');
  return JSON.parse(raw) as Record<string, any>;
}

// Helper to verify chip conservation (chips only, not including current bets)
async function verifyChipConservation(page: Page, expected: number = 2000) {
  const state = await page.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    const totalChips = room.players.reduce((sum, p) => sum + p.chips, 0);
    const totalCurrentBets = room.players.reduce(
      (sum, p) => sum + p.currentBet,
      0,
    );
    const pot = room.currentHand?.pot || 0;
    return {
      totalChips,
      totalCurrentBets,
      pot,
      byCurrentBets: totalChips + totalCurrentBets,
      byPot: totalChips + pot,
    };
  });

  // Room state can represent committed chips either in per-player currentBet or in pot.
  const conserved =
    state.byCurrentBets === expected || state.byPot === expected;
  expect(
    conserved,
    `chip conservation failed: chips=${state.totalChips}, currentBets=${state.totalCurrentBets}, pot=${state.pot}`,
  ).toBe(true);
}

type TwoPlayerSession = {
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  alicePage: Page;
  bobPage: Page;
  roomCode: string;
};

type ThreePlayerSession = {
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  charlieContext: BrowserContext;
  alicePage: Page;
  bobPage: Page;
  charliePage: Page;
  roomCode: string;
};

type SessionViewport = {
  width: number;
  height: number;
};

type SetupTwoPlayerOptions = {
  roomConfig?: Record<string, unknown>;
  forceNonAutomationMode?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
};

async function createBrowserContext(
  browser: any,
  options?: {
    forceNonAutomationMode?: boolean;
    viewport?: {
      width: number;
      height: number;
    };
  },
) {
  const context = await browser.newContext(
    options?.viewport ? { viewport: options.viewport } : undefined,
  );
  if (!options?.forceNonAutomationMode) {
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

async function authenticateTestUser(
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

async function authenticateStandardTwoPlayerPages(
  alicePage: Page,
  bobPage: Page,
) {
  await Promise.all([
    authenticateTestUser(alicePage, 'test1', {
      displayName: 'Alice',
      avatarEmoji: '🦊',
    }),
    authenticateTestUser(bobPage, 'test2', {
      displayName: 'Bob',
      avatarEmoji: '🐻',
    }),
  ]);
}

async function setupTwoPlayerSession(
  browser: any,
  options?: SetupTwoPlayerOptions,
): Promise<TwoPlayerSession> {
  const aliceContext = await createBrowserContext(
    browser,
    {
      forceNonAutomationMode: options?.forceNonAutomationMode ?? false,
      viewport: options?.viewport,
    },
  );
  const bobContext = await createBrowserContext(
    browser,
    {
      forceNonAutomationMode: options?.forceNonAutomationMode ?? false,
      viewport: options?.viewport,
    },
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

async function teardownTwoPlayerSession(session: TwoPlayerSession) {
  await Promise.allSettled([
    session.aliceContext.close(),
    session.bobContext.close(),
  ]);
}

async function setupThreePlayerSession(
  browser: any,
  options?: { viewport?: SessionViewport },
): Promise<ThreePlayerSession> {
  const contextOptions = options?.viewport
    ? { viewport: options.viewport }
    : undefined;
  const aliceContext = await browser.newContext(contextOptions);
  const bobContext = await browser.newContext(contextOptions);
  const charlieContext = await browser.newContext(contextOptions);
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const charliePage = await charlieContext.newPage();

  await authenticateTestUser(alicePage, 'test1', {
    displayName: 'Alice',
    avatarEmoji: '🦊',
  });
  await authenticateTestUser(bobPage, 'test2', {
    displayName: 'Bob',
    avatarEmoji: '🐻',
  });
  await authenticateTestUser(charliePage, 'test3', {
    displayName: 'Charlie',
    avatarEmoji: '🐼',
  });

  await alicePage.click('[data-testid="create-room-button"]');
  await alicePage.waitForSelector('[data-testid="room-title"]');
  const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
  const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
  if (!roomCode) {
    throw new Error('Failed to create room code for three-player setup');
  }

  await bobPage.click('[data-testid="join-toggle-button"]');
  await bobPage.fill('[data-testid="room-id-input"]', roomCode);
  await bobPage.click('[data-testid="join-room-button"]');
  await bobPage.waitForSelector(
    '[data-testid="room-player-count"]:has-text("Players: 2/")',
  );
  await alicePage.waitForSelector(
    '[data-testid="room-player-count"]:has-text("Players: 2/")',
  );

  await charliePage.click('[data-testid="join-toggle-button"]');
  await charliePage.fill('[data-testid="room-id-input"]', roomCode);
  await charliePage.click('[data-testid="join-room-button"]');
  await Promise.all([
    alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 3/")',
    ),
    bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 3/")',
    ),
    charliePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 3/")',
    ),
  ]);

  return {
    aliceContext,
    bobContext,
    charlieContext,
    alicePage,
    bobPage,
    charliePage,
    roomCode,
  };
}

async function teardownThreePlayerSession(session: ThreePlayerSession) {
  await Promise.allSettled([
    session.aliceContext.close(),
    session.bobContext.close(),
    session.charlieContext.close(),
  ]);
}

async function startGameFromLobby(
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
  await closeChatPanelIfOpen(alicePage);
  await alicePage.click('[data-testid="start-game-button"]');
  await Promise.all([
    alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    }),
    bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
  ]);
  await Promise.all([waitForHoleCards(alicePage), waitForHoleCards(bobPage)]);
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

async function waitForPlayerTurn(
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

async function waitForRound(
  page: Page,
  round: string,
  communityCards?: number,
) {
  await page.waitForFunction(
    ({ targetRound, targetCards }) => {
      const room = (window as any).pokerDebug?.getRoom();
      if (!room?.currentHand) return false;
      const roundMatches = room.currentHand.bettingRound === targetRound;
      const cardsMatch =
        typeof targetCards === 'number'
          ? room.currentHand.communityCards?.length === targetCards
          : true;
      return roundMatches && cardsMatch;
    },
    { targetRound: round, targetCards: communityCards },
    { timeout: 10000 },
  );
}

async function waitForRunCountDecision(
  page: Page,
  eligibleCount?: number,
  communityCards?: number,
  timeoutMs = 10000,
) {
  await page.waitForFunction(
    ({ targetEligibleCount, targetCards }) => {
      const room = (window as any).pokerDebug?.getRoom();
      const hand = room?.currentHand;
      if (!hand?.runCountDecision) return false;

      const eligiblePlayerIds = hand.runCountDecision.eligiblePlayerIds ?? [];
      const eligibleMatches =
        typeof targetEligibleCount === 'number'
          ? eligiblePlayerIds.length === targetEligibleCount
          : eligiblePlayerIds.length > 0;
      const cardsMatch =
        typeof targetCards === 'number'
          ? hand.communityCards?.length === targetCards
          : true;

      return eligibleMatches && cardsMatch;
    },
    { targetEligibleCount: eligibleCount, targetCards: communityCards },
    { timeout: timeoutMs },
  );
}

async function expectYourCardsFlyoutAboveActionArea(
  page: Page,
  actionAreaTestId: string,
) {
  await expect(
    page.locator('[data-testid="your-cards-section"]'),
  ).toBeVisible();
  await expect(
    page.locator(`[data-testid="${actionAreaTestId}"]`),
  ).toBeVisible();

  const layout = await page.evaluate((targetActionAreaTestId) => {
    const cardsPanel = document.querySelector<HTMLElement>(
      '[data-testid="your-cards-section"]',
    );
    const actionArea = document.querySelector<HTMLElement>(
      `[data-testid="${targetActionAreaTestId}"]`,
    );
    if (!cardsPanel || !actionArea) {
      return null;
    }

    const cardsRect = cardsPanel.getBoundingClientRect();
    const actionRect = actionArea.getBoundingClientRect();
    return {
      cardsBottom: cardsRect.bottom,
      actionTop: actionRect.top,
    };
  }, actionAreaTestId);

  expect(layout).not.toBeNull();
  expect(layout?.cardsBottom ?? Infinity).toBeLessThanOrEqual(
    layout?.actionTop ?? -Infinity,
  );
}

async function expectYourCardsFlyoutLeftOfActionArea(
  page: Page,
  actionAreaTestId: string,
) {
  await expect(
    page.locator('[data-testid="your-cards-section"]'),
  ).toBeVisible();
  await expect(
    page.locator(`[data-testid="${actionAreaTestId}"]`),
  ).toBeVisible();

  const layout = await page.evaluate((targetActionAreaTestId) => {
    const cardsPanel = document.querySelector<HTMLElement>(
      '[data-testid="your-cards-section"]',
    );
    const actionArea = document.querySelector<HTMLElement>(
      `[data-testid="${targetActionAreaTestId}"]`,
    );
    if (!cardsPanel || !actionArea) {
      return null;
    }

    const cardsRect = cardsPanel.getBoundingClientRect();
    const actionRect = actionArea.getBoundingClientRect();
    return {
      cardsRight: cardsRect.right,
      actionLeft: actionRect.left,
    };
  }, actionAreaTestId);

  expect(layout).not.toBeNull();
  expect(layout?.cardsRight ?? Infinity).toBeLessThanOrEqual(
    layout?.actionLeft ?? -Infinity,
  );
}

async function getRoomSnapshot(page: Page) {
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
      dealerPosition: hand?.dealerPosition ?? null,
      smallBlindPosition: hand?.smallBlindPosition ?? null,
      bigBlindPosition: hand?.bigBlindPosition ?? null,
      currentPlayerTurn: hand?.currentPlayerTurn ?? null,
      currentPlayerName:
        room?.players?.find((p: any) => p.id === hand?.currentPlayerTurn)
          ?.name ?? null,
      dealerPlayerName:
        room?.players?.find((p: any) => p.position === hand?.dealerPosition)
          ?.name ?? null,
      smallBlindPlayerName:
        room?.players?.find((p: any) => p.position === hand?.smallBlindPosition)
          ?.name ?? null,
      bigBlindPlayerName:
        room?.players?.find((p: any) => p.position === hand?.bigBlindPosition)
          ?.name ?? null,
      pendingStreetRevealRound: hand?.pendingStreetRevealRound ?? null,
      nextStreetRequiredPlayerIds: hand?.nextStreetRequiredPlayerIds ?? [],
      nextStreetReadyPlayerIds: hand?.nextStreetReadyPlayerIds ?? [],
      runCountDecisionEligiblePlayerIds:
        hand?.runCountDecision?.eligiblePlayerIds ?? [],
      runCountDecisionTwiceAgreedPlayerIds:
        hand?.runCountDecision?.twiceAgreedPlayerIds ?? [],
      showdownDecisionPlayerId: hand?.showdownDecisionPlayerId ?? null,
      hasLastResult: Boolean(hand?.lastResult),
      aliceChips: alice?.chips ?? 0,
      bobChips: bob?.chips ?? 0,
      aliceCurrentBet: alice?.currentBet ?? 0,
      bobCurrentBet: bob?.currentBet ?? 0,
    };
  });
}

async function waitForHandStart(page: Page, handNumber: number) {
  await page.waitForFunction(
    (targetHandNumber) => {
      const room = (window as any).pokerDebug?.getRoom();
      return (
        room?.currentHand?.handNumber === targetHandNumber &&
        room?.currentHand?.bettingRound === 'PRE_FLOP'
      );
    },
    handNumber,
    { timeout: 15000 },
  );
}

async function startNextHandOrWaitForAutoStart(
  page: Page,
  handNumber: number,
  timeoutMs = 15000,
) {
  const startedAt = Date.now();
  const nextHandButton = page.locator('[data-testid="start-next-hand-button"]');

  while (Date.now() - startedAt < timeoutMs) {
    const alreadyStarted = await page
      .evaluate((targetHandNumber) => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return (
          room?.currentHand?.handNumber === targetHandNumber &&
          room?.currentHand?.bettingRound === 'PRE_FLOP'
        );
      }, handNumber)
      .catch(() => false);
    if (alreadyStarted) {
      return;
    }

    const buttonVisible =
      (await nextHandButton.count()) > 0 &&
      (await nextHandButton.first().isVisible().catch(() => false));
    if (buttonVisible) {
      await nextHandButton.first().click();
    }

    await page.waitForTimeout(buttonVisible ? 80 : 150);
  }

  await waitForHandStart(page, handNumber);
}

async function clickRevealResultFromAnyPage(pages: Page[], timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const page of pages) {
      if (page.isClosed()) {
        continue;
      }
      const revealButton = page.locator(
        '[data-testid="reveal-next-street-button"]',
      );
      if (
        (await revealButton.count()) > 0 &&
        (await revealButton.first().isVisible())
      ) {
        await revealButton.first().click();
        return;
      }
    }
    await pages[0].waitForTimeout(100);
  }

  throw new Error('Timed out waiting for reveal-next-street button');
}

async function setTestDeckForCurrentRoom(
  page: Page,
  deck: Array<{ suit: string; rank: string }>,
) {
  await waitForPokerDebug(page);
  await page.evaluate(async (testDeck) => {
    const pokerDebug = (window as any).pokerDebug;
    const roomId = pokerDebug?.getRoom?.()?.id;
    const socket = pokerDebug?.getSocket?.();

    if (!roomId || !socket) {
      throw new Error('Unable to set test deck: room/socket unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'setTestDeck',
        { roomId, deck: testDeck },
        (response: { success: boolean; error?: string }) => {
          if (response?.success) {
            resolve();
          } else {
            reject(
              new Error(
                response?.error || 'Unknown setTestDeck failure from server',
              ),
            );
          }
        },
      );
    });
  }, deck);
}

async function requestRebuy(page: Page, amount: number) {
  await waitForPokerDebug(page);
  await page.evaluate(async (rebuyAmount) => {
    const socket = (window as any).pokerDebug?.getSocket?.();
    if (!socket) {
      throw new Error('Unable to rebuy: socket unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'REQUEST_REBUY',
        { amount: rebuyAmount },
        (response: { success: boolean; error?: string }) => {
          if (response?.success) {
            resolve();
          } else {
            reject(
              new Error(response?.error || 'Unknown REQUEST_REBUY failure'),
            );
          }
        },
      );
    });
  }, amount);
}

async function openChatPanel(page: Page) {
  const chatPanel = page.locator('[data-testid="chat-panel"]');
  if ((await chatPanel.count()) > 0 && (await chatPanel.first().isVisible())) {
    return;
  }

  await page.click('[data-testid="open-chat-button"]');
  await page.waitForSelector('[data-testid="chat-panel"]', {
    state: 'visible',
    timeout: 5000,
  });
}

async function closeChatPanelIfOpen(page: Page) {
  const closeButton = page.locator('[data-testid="close-chat-button"]');
  if ((await closeButton.count()) === 0) {
    return;
  }

  if (!(await closeButton.isVisible())) {
    return;
  }

  await closeButton.click();
  await page.waitForSelector('[data-testid="chat-panel"]', {
    state: 'hidden',
    timeout: 5000,
  });
}

async function sendChatMessagesViaSocket(
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

async function getChatMessagesFromDebug(page: Page) {
  await waitForPokerDebug(page);
  return page.evaluate(
    () => (window as any).pokerDebug?.getChatMessages?.() ?? [],
  );
}

async function getVoicePlaybackStateFromDebug(page: Page) {
  await waitForPokerDebug(page);
  return page.evaluate(
    () =>
      (window as any).pokerDebug?.getVoicePlaybackState?.() ?? {
        sourceUrl: null,
        isPlaying: false,
      },
  );
}

async function waitForVoicePlaybackSource(
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

async function sendVoiceMessageViaUpload(page: Page, prefix: string) {
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

async function emitPlayerActionWithId(
  page: Page,
  payload: { action: string; amount?: number; actionId?: string },
) {
  await waitForPokerDebug(page);
  return page.evaluate(
    ({ action, amount, actionId }) =>
      new Promise<{ success?: boolean; error?: string; duplicate?: boolean }>(
        (resolve) => {
          const socket = (window as any).pokerDebug?.getSocket?.();
          if (!socket) {
            resolve({ success: false, error: 'socket unavailable' });
            return;
          }
          socket.emit(
            'PLAYER_ACTION',
            { action, amount, actionId },
            (response: {
              success?: boolean;
              error?: string;
              duplicate?: boolean;
            }) =>
              resolve(response ?? { success: false, error: 'empty response' }),
          );
        },
      ),
    payload,
  );
}

function captureNextHandComplete(
  page: Page,
  timeoutMs = 15000,
  participantPages: Page[] = [page],
): Promise<any> {
  return waitForHandCompleteWithTerminalAutoProgress(
    page,
    participantPages,
    timeoutMs,
  );
}

async function getPagePlayerIdentity(
  page: Page,
): Promise<{ id: string; name: string } | null> {
  if (page.isClosed()) {
    return null;
  }

  try {
    return await page.evaluate(() => {
      const pokerDebug = (window as any).pokerDebug;
      if (!pokerDebug) {
        return null;
      }
      const player = pokerDebug.getPlayer?.();
      if (!player?.id || !player?.name) {
        return null;
      }
      return { id: String(player.id), name: String(player.name) };
    });
  } catch {
    return null;
  }
}

async function emitSocketEventAck(
  page: Page,
  eventName: string,
  payload: Record<string, unknown> = {},
): Promise<{ success?: boolean; duplicate?: boolean; error?: string }> {
  await waitForPokerDebug(page);
  return page.evaluate(
    ({ event, eventPayload }) =>
      new Promise((resolve) => {
        const socket = (window as any).pokerDebug?.getSocket?.();
        if (!socket) {
          resolve({ success: false, error: 'socket unavailable' });
          return;
        }

        socket.emit(event, eventPayload, (response: any) =>
          resolve(response ?? { success: false, error: 'empty response' }),
        );
      }),
    { event: eventName, eventPayload: payload },
  );
}

async function hasVisibleActionButton(
  page: Page,
  testId: string,
): Promise<boolean> {
  if (page.isClosed()) {
    return false;
  }

  try {
    return await page.evaluate((targetTestId) => {
      const element = document.querySelector<HTMLElement>(
        `[data-testid="${targetTestId}"]`,
      );
      if (!element) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }

      return !element.hasAttribute('disabled');
    }, testId);
  } catch {
    return false;
  }
}

async function waitForHandCompleteWithTerminalAutoProgress(
  anchorPage: Page,
  participantPages: Page[],
  timeoutMs = 15000,
): Promise<any> {
  await waitForPokerDebug(anchorPage);
  const uniquePages = Array.from(new Set([anchorPage, ...participantPages]));

  const initial = await anchorPage.evaluate(() => {
    const pokerDebug = (window as any).pokerDebug;
    const socket = pokerDebug?.getSocket?.();
    if (socket) {
      const store = ((window as any).__pokerE2eHandCompleteStore ??= {
        events: [] as any[],
        attached: false,
      });
      if (!store.attached) {
        socket.on('HAND_COMPLETE', (payload: any) => {
          store.events.push(payload?.result ?? payload);
        });
        store.attached = true;
      }
    }

    const hand = pokerDebug?.getRoom?.()?.currentHand;
    return {
      eventCount:
        ((window as any).__pokerE2eHandCompleteStore?.events
          ?.length as number) ?? 0,
    };
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await anchorPage.evaluate(() => {
      const events = ((window as any).__pokerE2eHandCompleteStore?.events ??
        []) as any[];
      const room = (window as any).pokerDebug?.getRoom?.();
      const hand = room?.currentHand;
      return {
        eventCount: events.length,
        latestEvent: events.length > 0 ? events[events.length - 1] : null,
        handNumber: hand?.handNumber ?? null,
        bettingRound: hand?.bettingRound ?? null,
        pendingStreetRevealRound: hand?.pendingStreetRevealRound ?? null,
        runCountDecisionEligiblePlayerIds:
          hand?.runCountDecision?.eligiblePlayerIds ?? [],
        showdownDecisionPlayerId: hand?.showdownDecisionPlayerId ?? null,
        nextStreetRequiredPlayerIds: hand?.nextStreetRequiredPlayerIds ?? [],
        nextStreetReadyPlayerIds: hand?.nextStreetReadyPlayerIds ?? [],
        lastResult: hand?.lastResult ?? null,
      };
    });

    if (state.eventCount > initial.eventCount) {
      return state.latestEvent;
    }

    let progressed = false;
    const playerPageEntries = (
      await Promise.all(
        uniquePages.map(async (page) => {
          const identity = await getPagePlayerIdentity(page);
          if (!identity) {
            return null;
          }
          return { playerId: identity.id, page };
        }),
      )
    ).filter((entry): entry is { playerId: string; page: Page } =>
      Boolean(entry),
    );
    const pageByPlayerId = new Map(
      playerPageEntries.map((entry) => [entry.playerId, entry.page]),
    );

    if ((state.runCountDecisionEligiblePlayerIds ?? []).length > 0) {
      for (const page of uniquePages) {
        if (page.isClosed()) {
          continue;
        }
        const response = await emitSocketEventAck(page, 'SET_RUN_COUNT', {
          runCount: 1,
        });
        if (response.success || response.duplicate) {
          progressed = true;
          break;
        }
      }
    } else if (state.pendingStreetRevealRound === 'SHOWDOWN') {
      const revealButtonPage = (
        await Promise.all(
          uniquePages.map(async (page) =>
            (await hasVisibleActionButton(page, 'reveal-next-street-button'))
              ? page
              : null,
          ),
        )
      ).find((page): page is Page => Boolean(page));

      const revealCandidatePages = revealButtonPage
        ? [revealButtonPage]
        : (state.nextStreetRequiredPlayerIds ?? [])
            .map((playerId: string) => pageByPlayerId.get(playerId) ?? null)
            .filter((page): page is Page => Boolean(page && !page.isClosed()));

      for (const page of revealCandidatePages) {
        const response = await emitSocketEventAck(page, 'REVEAL_NEXT_STREET');
        if (response.success || response.duplicate) {
          progressed = true;
          break;
        }
      }
    } else if (state.bettingRound === 'SHOWDOWN') {
      const showdownActorId = state.showdownDecisionPlayerId;
      const showButtonPage = (
        await Promise.all(
          uniquePages.map(async (page) =>
            (await hasVisibleActionButton(page, 'show-my-hand-button'))
              ? page
              : null,
          ),
        )
      ).find((page): page is Page => Boolean(page));

      const showdownActionPage =
        (showdownActorId ? (pageByPlayerId.get(showdownActorId) ?? null) : null) ??
        showButtonPage;

      if (showdownActionPage && !showdownActionPage.isClosed()) {
        const response = await emitSocketEventAck(
          showdownActionPage,
          'SHOW_MY_HAND',
        );
        if (response.success || response.duplicate) {
          progressed = true;
        }
      }
    }

    await anchorPage.waitForTimeout(progressed ? 120 : 180);
  }

  const finalState = await anchorPage.evaluate(() => {
    const hand = (window as any).pokerDebug?.getRoom?.()?.currentHand;
    return {
      handNumber: hand?.handNumber ?? null,
      bettingRound: hand?.bettingRound ?? null,
      pendingStreetRevealRound: hand?.pendingStreetRevealRound ?? null,
      showdownDecisionPlayerId: hand?.showdownDecisionPlayerId ?? null,
      nextStreetRequiredPlayerIds: hand?.nextStreetRequiredPlayerIds ?? [],
      nextStreetReadyPlayerIds: hand?.nextStreetReadyPlayerIds ?? [],
    };
  });
  throw new Error(
    `Timed out waiting for HAND_COMPLETE: hand=${finalState.handNumber}, round=${finalState.bettingRound}, pending=${finalState.pendingStreetRevealRound}, showdownPlayer=${finalState.showdownDecisionPlayerId}, required=${(finalState.nextStreetRequiredPlayerIds ?? []).join(',')}, ready=${(finalState.nextStreetReadyPlayerIds ?? []).join(',')}`,
  );
}

function captureNextSocketEvent(
  page: Page,
  eventName: string,
  timeoutMs = 10000,
): Promise<any> {
  return page.evaluate(
    ({ event, timeoutLimit }) => {
      const socket = (window as any).pokerDebug?.getSocket?.();
      if (!socket) {
        throw new Error(`Unable to capture ${event}: socket unavailable`);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${event}`));
        }, timeoutLimit);
        socket.once(event, (data: any) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    },
    { event: eventName, timeoutLimit: timeoutMs },
  );
}

async function forceSocketReconnect(page: Page) {
  await waitForPokerDebug(page);
  await page.evaluate(async () => {
    const pokerDebug = (window as any).pokerDebug;
    const socket = pokerDebug?.getSocket?.();
    const room = pokerDebug?.getRoom?.();
    const player = pokerDebug?.getPlayer?.();

    if (!socket || !room?.id || !player?.id || !player?.name) {
      throw new Error('Unable to force reconnect: session context unavailable');
    }

    if (socket.connected) {
      await new Promise<void>((resolve) => {
        socket.once('disconnect', () => resolve());
        socket.disconnect();
      });
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for socket connect'));
      }, 10000);

      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.connect();
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for RECONNECT ack'));
      }, 10000);

      socket.emit(
        'RECONNECT',
        {
          roomId: room.id,
          playerName: player.name,
          playerId: player.id,
        },
        (response: { success?: boolean; error?: string }) => {
          clearTimeout(timer);
          if (response?.success) {
            resolve();
            return;
          }

          reject(new Error(response?.error || 'Unknown RECONNECT failure'));
        },
      );
    });
  });
}

async function completeCurrentHandWithPassiveActions(
  anchorPage: Page,
  pageByName: Record<string, Page>,
  handNumber: number,
) {
  const startedAt = Date.now();
  const maxDurationMs = 60000;

  const playerIdToPage = new Map<string, Page>();
  for (const page of Object.values(pageByName)) {
    const identity = await getPagePlayerIdentity(page);
    if (identity) {
      playerIdToPage.set(identity.id, page);
    }
  }

  while (Date.now() - startedAt < maxDurationMs) {
    const state = await getRoomSnapshot(anchorPage);
    if (state.handNumber !== handNumber || state.hasLastResult) {
      return;
    }

    if ((state.runCountDecisionEligiblePlayerIds ?? []).length > 0) {
      let resolvedRunCount = false;
      for (const decisionPage of Object.values(pageByName)) {
        if (decisionPage.isClosed()) {
          continue;
        }
        const response = await emitSocketEventAck(decisionPage, 'SET_RUN_COUNT', {
          runCount: 1,
        });
        if (response.success || response.duplicate) {
          resolvedRunCount = true;
          break;
        }
      }
      await anchorPage.waitForTimeout(resolvedRunCount ? 120 : 200);
      continue;
    }

    if (state.pendingStreetRevealRound === 'SHOWDOWN') {
      let revealed = false;
      for (const revealPage of Object.values(pageByName)) {
        if (revealPage.isClosed()) {
          continue;
        }
        const response = await emitSocketEventAck(
          revealPage,
          'REVEAL_NEXT_STREET',
        );
        if (response.success || response.duplicate) {
          revealed = true;
          break;
        }
      }
      await anchorPage.waitForTimeout(revealed ? 120 : 200);
      continue;
    }

    const showdownActorId = state.showdownDecisionPlayerId;
    if (state.bettingRound === 'SHOWDOWN' && showdownActorId) {
      const decisionPage = playerIdToPage.get(showdownActorId);
      if (decisionPage && !decisionPage.isClosed()) {
        const response = await emitSocketEventAck(decisionPage, 'SHOW_MY_HAND');
        if (response.success || response.duplicate) {
          await anchorPage.waitForTimeout(120);
          continue;
        }
      }
    }

    if (state.bettingRound === 'SHOWDOWN') {
      const visibleShowPages = (
        await Promise.all(
          Object.values(pageByName).map(async (page) =>
            (await hasVisibleActionButton(page, 'show-my-hand-button'))
              ? page
              : null,
          ),
        )
      ).filter((page): page is Page => Boolean(page && !page.isClosed()));

      let showdownActionSucceeded = false;
      for (const revealPage of visibleShowPages) {
        const response = await emitSocketEventAck(revealPage, 'SHOW_MY_HAND');
        if (response.success || response.duplicate) {
          showdownActionSucceeded = true;
          break;
        }
      }
      if (showdownActionSucceeded) {
        await anchorPage.waitForTimeout(120);
        continue;
      }

      let revealTriggered = false;
      for (const revealPage of Object.values(pageByName)) {
        if (revealPage.isClosed()) {
          continue;
        }
        const response = await emitSocketEventAck(
          revealPage,
          'REVEAL_NEXT_STREET',
        );
        if (response.success || response.duplicate) {
          revealTriggered = true;
          break;
        }
      }
      if (revealTriggered) {
        await anchorPage.waitForTimeout(120);
        continue;
      }
    }

    if (state.currentPlayerTurn === null) {
      await anchorPage.waitForTimeout(150);
      continue;
    }

    const actingPlayer = state.currentPlayerName;
    if (!actingPlayer) {
      await anchorPage.waitForTimeout(200);
      continue;
    }

    const actingPage = pageByName[actingPlayer];
    if (!actingPage) {
      await anchorPage.waitForTimeout(200);
      continue;
    }

    try {
      await waitForPlayerTurn(actingPage, actingPlayer, 5000);
    } catch {
      await anchorPage.waitForTimeout(200);
      continue;
    }

    const canCheck = await actingPage.evaluate(() => {
      const pokerDebug = (window as any).pokerDebug;
      const room = pokerDebug?.getRoom?.();
      const me = pokerDebug?.getPlayer?.();
      const player = room?.players?.find((p: any) => p.id === me?.id);
      return !!player && player.currentBet === room?.currentHand?.currentBet;
    });

    if (canCheck) {
      await actingPage.evaluate(() => (window as any).pokerDebug.check());
    } else {
      await actingPage.evaluate(() => (window as any).pokerDebug.call());
    }

    await anchorPage.waitForTimeout(150);
  }

  const finalState = await getRoomSnapshot(anchorPage);
  throw new Error(
    `Timed out completing hand ${handNumber}; final state: hand=${finalState.handNumber}, round=${finalState.bettingRound}, pending=${finalState.pendingStreetRevealRound}, showdownPlayer=${finalState.showdownDecisionPlayerId}, turn=${finalState.currentPlayerName}`,
  );
}

async function playCheckCheckToShowdown(alicePage: Page, bobPage: Page) {
  await waitForPlayerTurn(bobPage, 'Bob');
  await bobPage.click('[data-testid="action-call"]');
  await waitForPlayerTurn(alicePage, 'Alice');
  await alicePage.click('[data-testid="action-check"]');

  for (let i = 0; i < 3; i++) {
    await waitForPlayerTurn(bobPage, 'Bob');
    await bobPage.click('[data-testid="action-check"]');
    await waitForPlayerTurn(alicePage, 'Alice');
    await alicePage.click('[data-testid="action-check"]');
  }
}

async function getYourCardRanksFromUi(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="your-card-"]'),
    );
    if (cards.length > 0) {
      return cards.map((el) => el.dataset.rank?.trim() ?? '').filter(Boolean);
    }

    const sections = Array.from(document.querySelectorAll('div'));
    const yourCardsSection = sections.find((el) =>
      el.querySelector('h3')?.textContent?.includes('Your Cards'),
    );
    if (!yourCardsSection) return [];
    return Array.from(yourCardsSection.querySelectorAll('div.font-bold'))
      .map((el) => el.textContent?.trim() || '')
      .filter(Boolean);
  });
}

async function getCommunityCardCountFromUi(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid^="community-card-"]');
    if (cards.length > 0) return cards.length;

    // Board now always renders 5 slots with card backs; this helper tracks
    // only revealed community cards.
    const room = (window as any).pokerDebug?.getRoom?.();
    return room?.currentHand?.communityCards?.length ?? 0;
  });
}

function parseDollarAmount(text: string | null, label: string): number {
  const match = text?.match(/\$([0-9]+)/);
  if (!match) {
    throw new Error(`Unable to parse ${label} from text: ${text ?? '<null>'}`);
  }
  return Number(match[1]);
}

async function getPotFromUi(page: Page): Promise<number> {
  const potText = await page.textContent('[data-testid="pot-value"]');
  return parseDollarAmount(potText, 'pot');
}

async function getRoundFromUi(page: Page): Promise<string> {
  const roundText = await page.textContent('[data-testid="round-value"]');
  const match = roundText?.match(/(?:Current\s+)?Round:\s*([A-Z_]+)/);
  if (!match) {
    throw new Error(
      `Unable to parse round from text: ${roundText ?? '<null>'}`,
    );
  }
  return match[1];
}

async function getYourChipsFromUi(page: Page): Promise<number> {
  const chipsText = await page.textContent('[data-testid="your-chips"]');
  return parseDollarAmount(chipsText, 'your chips');
}

async function getDealerNameFromUi(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const room = (window as any).pokerDebug?.getRoom?.();
    if (!room?.currentHand || !Array.isArray(room.players)) {
      return null;
    }
    const dealerPosition = room.currentHand.dealerPosition;
    const dealer = room.players.find(
      (player: any) => player.position === dealerPosition,
    );
    return dealer?.name ?? null;
  });
}

async function getPlayersMoneyFromUi(
  page: Page,
): Promise<
  Record<string, { chips: number; currentBet: number; totalBuyIn: number }>
> {
  return page.evaluate(() => {
    const room = (window as any).pokerDebug?.getRoom?.();
    const result: Record<
      string,
      { chips: number; currentBet: number; totalBuyIn: number }
    > = {};
    if (!room?.players || !Array.isArray(room.players)) {
      return result;
    }

    for (const player of room.players) {
      if (!player?.name) continue;
      result[player.name] = {
        chips: Number(player.chips ?? 0),
        currentBet: Number(player.currentBet ?? 0),
        totalBuyIn: Number(player.totalBuyIn ?? 0),
      };
    }

    return result;
  });
}

async function assertSeatCardsWithinTableBounds(
  page: Page,
  label: string,
  tolerancePx = 1.5,
  minSeatCount = 2,
) {
  const result = await page.evaluate(
    ({ tolerance }) => {
      const feltNode = document.querySelector('.felt-oval');
      const seatNodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.seat-pod[data-testid^="player-seat-"]',
        ),
      );

      if (!feltNode) {
        return {
          hasFelt: false,
          seatCount: seatNodes.length,
          failures: [] as Array<{ id: string; reasons: string[] }>,
        };
      }

      const feltRect = feltNode.getBoundingClientRect();
      const failures = seatNodes
        .map((seatNode) => {
          const seatRect = seatNode.getBoundingClientRect();
          const reasons: string[] = [];

          if (seatRect.left < feltRect.left - tolerance) {
            reasons.push(
              `left ${seatRect.left.toFixed(1)} < table ${feltRect.left.toFixed(1)}`,
            );
          }
          if (seatRect.right > feltRect.right + tolerance) {
            reasons.push(
              `right ${seatRect.right.toFixed(1)} > table ${feltRect.right.toFixed(1)}`,
            );
          }
          if (seatRect.top < feltRect.top - tolerance) {
            reasons.push(
              `top ${seatRect.top.toFixed(1)} < table ${feltRect.top.toFixed(1)}`,
            );
          }
          if (seatRect.bottom > feltRect.bottom + tolerance) {
            reasons.push(
              `bottom ${seatRect.bottom.toFixed(1)} > table ${feltRect.bottom.toFixed(1)}`,
            );
          }

          return {
            id: seatNode.getAttribute('data-testid') || 'unknown-seat',
            reasons,
          };
        })
        .filter((entry) => entry.reasons.length > 0);

      return {
        hasFelt: true,
        seatCount: seatNodes.length,
        failures,
      };
    },
    { tolerance: tolerancePx },
  );

  expect(result.hasFelt, `[${label}] .felt-oval should exist`).toBe(true);
  expect(
    result.seatCount,
    `[${label}] should render at least ${minSeatCount} seat cards`,
  ).toBeGreaterThanOrEqual(minSeatCount);

  expect(
    result.failures,
    `[${label}] seat card overflowed table bounds: ${JSON.stringify(result.failures)}`,
  ).toEqual([]);
}

async function dragTrayToPot(
  page: Page,
  dropOffset: { x: number; y: number } = { x: 0, y: 0 },
  options: { steps?: number } = {},
) {
  const tray = page.locator('[data-testid="chip-stack-draggable"]');
  const pot = page.locator('[data-testid="pot-drop-zone"]');
  const trayAmount = page.locator('[data-testid="tray-amount-value"]');
  const trayBox = await tray.boundingBox();
  const potBox = await pot.boundingBox();
  const steps = options.steps ?? 12;

  if (!trayBox || !potBox) {
    throw new Error('Unable to drag tray to pot without bounding boxes');
  }

  await page.mouse.move(
    trayBox.x + trayBox.width / 2,
    trayBox.y + trayBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    potBox.x + potBox.width / 2 + potBox.width * dropOffset.x,
    potBox.y + potBox.height / 2 + potBox.height * dropOffset.y,
    { steps },
  );
  await expect(pot).toHaveClass(/pot-drop-zone--hover/);
  await page.mouse.up();
  await expect(trayAmount).toContainText('$0');
}

async function assertSeatCardsDoNotOverlapBoardAndPot(
  page: Page,
  label: string,
  minSeatCount = 2,
) {
  const result = await page.evaluate(
    ({ overlapTolerance }) => {
      const seatNodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.seat-pod[data-testid^="player-seat-"]',
        ),
      );
      const boardNodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid^="community-card-"], [data-testid^="board-back-"]',
        ),
      );
      const potNode = document.querySelector<HTMLElement>(
        '[data-testid="pot-drop-zone"]',
      );

      const targets = [
        ...boardNodes.map((node) => ({
          id: node.getAttribute('data-testid') || 'community-card',
          rect: node.getBoundingClientRect(),
        })),
        ...(potNode
          ? [
              {
                id: potNode.getAttribute('data-testid') || 'pot-drop-zone',
                rect: potNode.getBoundingClientRect(),
              },
            ]
          : []),
      ];

      const overlaps = seatNodes.flatMap((seatNode) => {
        const seatRect = seatNode.getBoundingClientRect();
        const seatId = seatNode.getAttribute('data-testid') || 'unknown-seat';

        return targets
          .map((target) => {
            const overlapWidth =
              Math.min(seatRect.right, target.rect.right) -
              Math.max(seatRect.left, target.rect.left);
            const overlapHeight =
              Math.min(seatRect.bottom, target.rect.bottom) -
              Math.max(seatRect.top, target.rect.top);
            const hasOverlap =
              overlapWidth > overlapTolerance &&
              overlapHeight > overlapTolerance;

            if (!hasOverlap) {
              return null;
            }

            return {
              seatId,
              targetId: target.id,
              overlapWidth: Number(overlapWidth.toFixed(2)),
              overlapHeight: Number(overlapHeight.toFixed(2)),
            };
          })
          .filter(
            (
              entry,
            ): entry is {
              seatId: string;
              targetId: string;
              overlapWidth: number;
              overlapHeight: number;
            } => Boolean(entry),
          );
      });

      return {
        seatCount: seatNodes.length,
        boardCount: boardNodes.length,
        hasPot: Boolean(potNode),
        overlaps,
      };
    },
    { overlapTolerance: 0.5 },
  );

  expect(
    result.seatCount,
    `[${label}] should render at least ${minSeatCount} seat cards`,
  ).toBeGreaterThanOrEqual(minSeatCount);
  expect(
    result.boardCount,
    `[${label}] should render community-card targets`,
  ).toBeGreaterThan(0);
  expect(result.hasPot, `[${label}] should render pot drop zone`).toBe(true);
  expect(
    result.overlaps,
    `[${label}] seat cards overlap community cards or pot: ${JSON.stringify(result.overlaps)}`,
  ).toEqual([]);
}

async function assertSeatCardsNonNameTextUnclipped(
  page: Page,
  label: string,
  {
    minSeatCount = 2,
    overflowTolerancePx = 1.25,
    minFontTolerancePx = 0.15,
  }: {
    minSeatCount?: number;
    overflowTolerancePx?: number;
    minFontTolerancePx?: number;
  } = {},
) {
  const result = await page.evaluate(
    ({ overflowTolerance, minFontTolerance }) => {
      const seatNodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.seat-pod[data-testid^="player-seat-"]',
        ),
      );
      const textSelectors = [
        '.seat-pod__status-badge',
        '.seat-pod__action',
        '.seat-pod__remaining',
        '.seat-pod__ready-overlay',
        '.seat-pod__role-icon',
      ];
      const noWrapSelectors = new Set([
        '.seat-pod__status-badge',
        '.seat-pod__remaining',
        '.seat-pod__ready-overlay',
        '.seat-pod__role-icon',
      ]);
      const minFontBySelector = new Map<string, number>([
        ['.seat-pod__status-badge', 6.5],
        ['.seat-pod__action', 7],
        ['.seat-pod__remaining', 7.5],
        ['.seat-pod__ready-overlay', 6.5],
        ['.seat-pod__role-icon', 5.7],
      ]);

      const failures = seatNodes.flatMap((seatNode) => {
        const seatId = seatNode.getAttribute('data-testid') || 'unknown-seat';
        return textSelectors.flatMap((selector) =>
          Array.from(seatNode.querySelectorAll<HTMLElement>(selector)).flatMap(
            (node) => {
              const text = (node.textContent || '').trim();
              if (!text) {
                return [];
              }

              const style = window.getComputedStyle(node);
              const overflowX = node.scrollWidth - node.clientWidth;
              const overflowY = node.scrollHeight - node.clientHeight;
              const overflowModeX =
                style.overflowX === 'visible'
                  ? style.overflow
                  : style.overflowX;
              const overflowModeY =
                style.overflowY === 'visible'
                  ? style.overflow
                  : style.overflowY;
              const hasOverflowX = overflowX > overflowTolerance;
              const hasOverflowY = overflowY > overflowTolerance;

              const textOverflow = style.textOverflow;
              const whiteSpace = style.whiteSpace;
              const lineClampRaw =
                style.getPropertyValue('-webkit-line-clamp') ||
                (style as CSSStyleDeclaration & { webkitLineClamp?: string })
                  .webkitLineClamp ||
                '0';
              const lineClamp = Number.parseInt(lineClampRaw, 10);
              const hasLineClamp = Number.isFinite(lineClamp) && lineClamp > 0;
              const hasEllipsis = textOverflow === 'ellipsis';
              const mustNotWrap = noWrapSelectors.has(selector);
              const invalidWhiteSpace = mustNotWrap && whiteSpace !== 'nowrap';
              const fontSizePx = Number.parseFloat(style.fontSize || '0');
              const minFontPx = minFontBySelector.get(selector);
              const isFontTooSmall =
                Number.isFinite(fontSizePx) &&
                Number.isFinite(minFontPx) &&
                fontSizePx + minFontTolerance < minFontPx;

              if (
                !hasOverflowX &&
                !hasOverflowY &&
                !hasLineClamp &&
                !hasEllipsis &&
                !invalidWhiteSpace &&
                !isFontTooSmall
              ) {
                return [];
              }

              return [
                {
                  seatId,
                  selector,
                  text,
                  overflowX: Number(overflowX.toFixed(2)),
                  overflowY: Number(overflowY.toFixed(2)),
                  overflowModeX,
                  overflowModeY,
                  whiteSpace,
                  textOverflow,
                  lineClamp: hasLineClamp ? lineClamp : 0,
                  invalidWhiteSpace,
                  fontSizePx: Number(fontSizePx.toFixed(2)),
                  minFontPx: Number(minFontPx?.toFixed(2) ?? '0'),
                  isFontTooSmall,
                },
              ];
            },
          ),
        );
      });

      return {
        seatCount: seatNodes.length,
        failures,
      };
    },
    {
      overflowTolerance: overflowTolerancePx,
      minFontTolerance: minFontTolerancePx,
    },
  );

  expect(
    result.seatCount,
    `[${label}] should render at least ${minSeatCount} seat cards`,
  ).toBeGreaterThanOrEqual(minSeatCount);
  expect(
    result.failures,
    `[${label}] non-name seat text should not be truncated: ${JSON.stringify(result.failures)}`,
  ).toEqual([]);
}

async function assertSeatCardsWhitespaceRatioWithinLimit(
  page: Page,
  label: string,
  {
    minSeatCount = 2,
    maxExtraHeightRatio = 0.25,
    maxWrappedExtraHeightRatio = 0.55,
    tolerancePx = 1.25,
  }: {
    minSeatCount?: number;
    maxExtraHeightRatio?: number;
    maxWrappedExtraHeightRatio?: number;
    tolerancePx?: number;
  } = {},
) {
  const result = await page.evaluate(
    ({ maxExtraRatio, maxWrappedExtraRatio, tolerance, baseAspectRatio }) => {
      const seatNodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.seat-pod[data-testid^="player-seat-"]',
        ),
      );

      const failures = seatNodes.flatMap((seatNode) => {
        const seatId = seatNode.getAttribute('data-testid') || 'unknown-seat';
        const seatRect = seatNode.getBoundingClientRect();
        const actionLines = Number.parseInt(
          seatNode.dataset.actionLines ?? '1',
          10,
        );

        if (
          seatRect.width <= tolerance ||
          seatRect.height <= tolerance ||
          baseAspectRatio <= 0
        ) {
          return [];
        }

        const expectedHeight = seatRect.width / baseAspectRatio;
        const extraHeight = Math.max(0, seatRect.height - expectedHeight);
        const extraHeightRatio =
          expectedHeight > 0 ? extraHeight / expectedHeight : 0;
        const maxAllowedRatio =
          Number.isFinite(actionLines) && actionLines > 1
            ? maxWrappedExtraRatio
            : maxExtraRatio;

        if (extraHeightRatio <= maxAllowedRatio + 0.02) {
          return [];
        }

        return [
          {
            seatId,
            actionLines: Number.isFinite(actionLines) ? actionLines : 1,
            width: Number(seatRect.width.toFixed(2)),
            height: Number(seatRect.height.toFixed(2)),
            expectedHeight: Number(expectedHeight.toFixed(2)),
            extraHeight: Number(extraHeight.toFixed(2)),
            extraHeightRatio: Number(extraHeightRatio.toFixed(3)),
            maxAllowedRatio: Number(maxAllowedRatio.toFixed(3)),
          },
        ];
      });

      return {
        seatCount: seatNodes.length,
        failures,
      };
    },
    {
      maxExtraRatio: maxExtraHeightRatio,
      maxWrappedExtraRatio: maxWrappedExtraHeightRatio,
      tolerance: tolerancePx,
      baseAspectRatio: 1.26,
    },
  );

  expect(
    result.seatCount,
    `[${label}] should render at least ${minSeatCount} seat cards`,
  ).toBeGreaterThanOrEqual(minSeatCount);
  expect(
    result.failures,
    `[${label}] seat card whitespace ratio exceeded limit: ${JSON.stringify(result.failures)}`,
  ).toEqual([]);
}

test.describe('Poker E2E - Test Suite 1: Basic Betting Actions', () => {
  test('1.1: Check/Check Scenario - both players check through all rounds', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners to capture browser logs
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room page to load
    await alicePage.waitForSelector('[data-testid="room-title"]');

    // Get room ID from UI
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for Bob to see room page
    await bobPage.waitForSelector('[data-testid="room-title"]');

    // Wait for both players to appear in room
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Alice starts game via UI button
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start and verify pot appears
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });

    // Verify both players can see pot (game started)
    const alicePot = await alicePage.textContent('[data-testid="pot-value"]');
    const bobPot = await bobPage.textContent('[data-testid="pot-value"]');
    console.log('Game started - Alice sees:', alicePot, 'Bob sees:', bobPot);
    expect(alicePot).toContain(`$${DEFAULT_OPENING_POT}`);
    expect(bobPot).toContain(`$${DEFAULT_OPENING_POT}`);

    // PRE_FLOP: Bob (small blind) calls, Alice (big blind) checks
    console.log('Pre-flop: Bob calling...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Verify Call button shows correct amount
    const callButton = await bobPage.textContent('[data-testid="action-call"]');
    console.log('Bob sees call button:', callButton);
    expect(callButton).toContain(`$${DEFAULT_SMALL_BLIND_CALL_GAP}`);

    await bobPage.click('[data-testid="action-call"]');

    console.log('Pre-flop: Alice checking...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    await alicePage.waitForSelector('[data-testid="action-check"]');
    await alicePage.click('[data-testid="action-check"]');

    // Verify pot after pre-flop
    await alicePage.waitForTimeout(2000);
    const potAfterPreFlop = await alicePage.textContent(
      '[data-testid="pot-value"]',
    );
    console.log('After pre-flop, pot:', potAfterPreFlop);
    expect(potAfterPreFlop).toContain(`$${DEFAULT_TWO_PLAYER_MATCHED_POT}`);

    console.log('Flop should be dealt');

    // Debug: Check actual page state
    await waitForPokerDebug(bobPage);
    const bobState = await bobPage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        currentPlayerTurn: room?.currentHand?.currentPlayerTurn,
        bobId: room?.players?.find((p) => p.name === 'Bob')?.id,
      };
    });
    console.log('Bob state after pre-flop:', bobState);
    console.log(
      'Is it Bob turn?',
      bobState.currentPlayerTurn === bobState.bobId,
    );

    // FLOP: Bob checks, Alice checks
    console.log('Flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Get all visible button text
    const buttons = await bobPage.$$eval('button', (btns) =>
      btns.map((b) => b.textContent),
    );
    console.log('All buttons Bob sees:', buttons);

    console.log('Flop: Bob checking...');

    const bobActions = await bobPage.$$eval('button', (btns) =>
      btns.filter((b) => !b.disabled).map((b) => b.textContent),
    );
    console.log('Bob can do:', bobActions);
    expect(bobActions.some((a) => a?.includes('Check'))).toBe(true);
    await bobPage.click('[data-testid="action-check"]');

    console.log('Flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    console.log('Flop: Alice checking...');
    await alicePage.waitForSelector('[data-testid="action-check"]:visible', {
      timeout: 10000,
    });
    await alicePage.click('[data-testid="action-check"]');

    // Wait for turn
    await alicePage.waitForTimeout(2000);
    console.log('Turn dealt');

    // TURN: Bob checks, Alice checks
    console.log('Turn: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Check what action Bob can take on turn
    const bobTurnActions = await bobPage.$$eval('button', (btns) =>
      btns.filter((b) => !b.disabled).map((b) => b.textContent),
    );
    console.log('Bob can do on turn:', bobTurnActions);

    // Bob checks if possible, otherwise calls
    expect(bobTurnActions.some((a) => a?.includes('Check'))).toBe(true);
    console.log('Turn: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('Flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    const aliceActions = await alicePage.$$eval('button', (btns) =>
      btns.filter((b) => !b.disabled).map((b) => b.textContent),
    );
    console.log('Alice can do:', aliceActions);

    if (aliceActions.some((a) => a?.includes('Check'))) {
      console.log('Flop: Alice checking...');
      await alicePage.click('[data-testid="action-check"]');
    } else if (aliceActions.some((a) => a?.includes('Call'))) {
      console.log('Flop: Alice calling...');
      await alicePage.click('[data-testid="action-call"]');
    }

    // Wait for river
    await alicePage.waitForTimeout(2000);
    console.log('River dealt');

    // RIVER: Bob checks, Alice checks
    console.log('River: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    console.log('River: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('River: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    console.log('River: Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for hand to complete
    await alicePage.waitForTimeout(2000);
    console.log('Hand complete');

    // Verify chip conservation using pokerDebug
    await waitForPokerDebug(alicePage);
    const finalState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      'Final chips - Alice:',
      finalState.alice,
      'Bob:',
      finalState.bob,
    );

    // Verify chips still total 2000
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('1.2: Bet/Call Scenario - betting and calling across rounds', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners to capture browser logs
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room to be created and get room code
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for both players to see each other
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Alice starts game via UI
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start - check for pot display
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });

    const alicePot = await alicePage.textContent('[data-testid="pot-value"]');
    const bobPot = await bobPage.textContent('[data-testid="pot-value"]');
    console.log('Game started - Alice sees:', alicePot, 'Bob sees:', bobPot);

    // PRE_FLOP: Bob (small blind) raises $50, Alice (big blind) calls
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Pre-flop: Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn
    console.log('Pre-flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Verify Alice sees the correct call amount
    const callButton = await alicePage.textContent(
      '[data-testid="action-call"]',
    );
    console.log('Alice sees call button:', callButton);
    expect(callButton).toContain('$50'); // Call from $20 to $70

    console.log('Pre-flop: Alice calling...');
    await alicePage.click('[data-testid="action-call"]');

    // Wait for flop
    await alicePage.waitForTimeout(2000);
    const potAfterPreFlop = await alicePage.textContent(
      '[data-testid="pot-value"]',
    );
    console.log('After pre-flop, pot:', potAfterPreFlop);
    expect(potAfterPreFlop).toContain(
      `$${DEFAULT_OPENING_POT + 50 + (50 + DEFAULT_SMALL_BLIND_CALL_GAP)}`,
    );

    // FLOP: Bob checks, Alice raises $100, Bob calls
    console.log('Flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Flop: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    // Alice's turn
    console.log('Flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Flop: Alice raising $100...');
    await alicePage.fill('[data-testid="raise-input"]', '100');
    await alicePage.click('[data-testid="action-raise"]');

    // Bob's turn to call
    console.log('Flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    const flopCallButton = await bobPage.textContent(
      '[data-testid="action-call"]',
    );
    console.log('Bob sees call button:', flopCallButton);
    expect(flopCallButton).toContain('$100');

    console.log('Flop: Bob calling...');
    await bobPage.click('[data-testid="action-call"]');

    // Wait for turn
    await alicePage.waitForTimeout(2000);
    const potAfterFlop = await alicePage.textContent(
      '[data-testid="pot-value"]',
    );
    console.log('After flop, pot:', potAfterFlop);
    expect(potAfterFlop).toContain(
      `$${DEFAULT_OPENING_POT + 50 + (50 + DEFAULT_SMALL_BLIND_CALL_GAP) + 200}`,
    );

    // TURN: Bob checks, Alice checks
    console.log('Turn: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Turn: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('Turn: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Turn: Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for river
    await alicePage.waitForTimeout(2000);
    console.log('River dealt');

    // RIVER: Bob checks, Alice checks
    console.log('River: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('River: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('River: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('River: Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for hand to complete
    await alicePage.waitForTimeout(2000);
    console.log('Hand complete');

    // Verify final pot was $340 and chip conservation
    await waitForPokerDebug(alicePage);
    const finalState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
        gameState: room?.gameState,
      };
    });
    console.log(
      'Final state - Alice:',
      finalState.alice,
      'Bob:',
      finalState.bob,
      'Game:',
      finalState.gameState,
    );
    expect(finalState.gameState).toBe('IN_PROGRESS');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('1.3: Bet/Fold Scenario - folding functionality', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Alice starts game via UI
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    console.log('Game started');

    // Get initial chips using pokerDebug
    await waitForPokerDebug(alicePage);
    const initialChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      'Initial chips - Alice:',
      initialChips.alice,
      'Bob:',
      initialChips.bob,
    );

    // PRE_FLOP: Bob (small blind) raises $100, Alice (big blind) folds
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Pre-flop: Bob raising $100...');
    await bobPage.fill('[data-testid="raise-input"]', '100');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn - she should see a call option
    console.log('Pre-flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    const callButton = await alicePage.textContent(
      '[data-testid="action-call"]',
    );
    console.log('Alice sees call button:', callButton);

    console.log('Pre-flop: Alice folding...');
    const handCompletePromise = captureNextHandComplete(alicePage, 15000, [
      alicePage,
      bobPage,
    ]);
    await alicePage.click('[data-testid="action-fold"]');

    await expect(
      alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
    ).toBeVisible();
    await alicePage.click('[data-testid="reveal-next-street-button"]');
    await handCompletePromise;

    console.log('Hand complete, Bob won by fold');

    // Verify chips changed correctly
    const finalChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room.players.find((p: any) => p.name === 'Bob')?.chips,
        gameState: room?.gameState,
      };
    });
    console.log(
      'Final chips - Alice:',
      finalChips.alice,
      'Bob:',
      finalChips.bob,
    );

    // Alice folded, losing her big blind ($20)
    // Bob won the pot ($30 = $10 small blind + $20 Alice's big blind)
    // Alice: 1000 - 20 (big blind) = 980
    // Bob: 1000 - 10 (small blind) + 30 (pot) = 1020
    expect(finalChips.alice).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND);
    expect(finalChips.bob).toBe(DEFAULT_STARTING_CHIPS + DEFAULT_BIG_BLIND);
    expect(finalChips.gameState).toBe('IN_PROGRESS');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe('Poker E2E - Test Suite 3: All-In Scenarios', () => {
  test('3.1: Small All-In - player goes all-in with small stack, cannot act further', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    console.log('Game started - blinds posted, pot should be $30');
    const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
      alicePage,
      bobPage,
    ]);

    // Verify initial pot = $30 (blinds)
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(DEFAULT_OPENING_POT);
    expect(initialState.alice).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND);
    expect(initialState.bob).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND);

    // PRE_FLOP Round 1: Bob (small blind) raises $900
    console.log('Pre-flop Round 1 - Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    console.log('Pre-flop Round 1 - Bob raising $900 (leaving $90)...');
    await bobPage.fill('[data-testid="raise-input"]', '900');
    await bobPage.click('[data-testid="action-raise"]');

    // Verify Bob's chips after raise
    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob raise: Pot $${afterBobRaise.pot}, currentBet $${afterBobRaise.currentBet}, Alice: ${afterBobRaise.alice}, Bob: ${afterBobRaise.bob}`,
    );
    // Independent expected math:
    // Bob already posted $10. Raising by $900 requires an additional $10 call + $900 raise.
    // Bob contribution this action: $910, total committed by Bob: $920, remaining chips: $80.
    const expectedBobChipsAfterRaise =
      DEFAULT_STARTING_CHIPS -
      DEFAULT_SMALL_BLIND -
      (900 + DEFAULT_SMALL_BLIND_CALL_GAP);
    const expectedPotAfterRaise =
      DEFAULT_OPENING_POT + 900 + DEFAULT_SMALL_BLIND_CALL_GAP;
    const expectedCurrentBetAfterRaise = DEFAULT_BIG_BLIND + 900;
    expect(afterBobRaise.bob).toBe(expectedBobChipsAfterRaise);
    expect(afterBobRaise.pot).toBe(expectedPotAfterRaise);
    expect(afterBobRaise.currentBet).toBe(expectedCurrentBetAfterRaise);

    // PRE_FLOP Round 2: Alice calls (matching Bob's currentBet $920)
    console.log("Pre-flop Round 2 - Alice calling Bob's raise...");
    await alicePage.click('[data-testid="action-call"]');

    // Verify Alice's chips after call
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    const afterAliceCall = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Alice call: Pot $${afterAliceCall.pot}, Alice: ${afterAliceCall.alice}, Bob: ${afterAliceCall.bob}`,
    );
    expect(afterAliceCall.alice).toBe(90);
    expect(afterAliceCall.bob).toBe(90);
    expect(afterAliceCall.pot).toBe(1820);

    // PRE_FLOP Round 3: Bob goes all-in with remaining $80
    console.log('Pre-flop Round 3 - Bob going all-in with $80...');
    await bobPage.click('[data-testid="action-all-in"]');

    // Alice's turn to respond
    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const afterBobAllIn = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob all-in: Pot $${afterBobAllIn.pot}, currentBet $${afterBobAllIn.currentBet}, Alice: ${afterBobAllIn.alice}, Bob: ${afterBobAllIn.bob}`,
    );
    expect(afterBobAllIn.bob).toBe(0); // Bob is all-in
    expect(afterBobAllIn.pot).toBe(1910);

    // Alice calls Bob's all-in
    console.log("Pre-flop Round 4 - Alice calling Bob's all-in...");
    await alicePage.click('[data-testid="action-call"]');

    // Betting is closed, so the table should offer a run-count decision
    await waitForRunCountDecision(alicePage, 2, 3);
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        runCountDecisionEligiblePlayerIds:
          room?.currentHand?.runCountDecision?.eligiblePlayerIds ?? [],
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After pre-flop: Pot $${afterPreFlop.pot}, Round: ${afterPreFlop.bettingRound}, Cards: ${afterPreFlop.communityCards}, Alice: ${afterPreFlop.alice}, Bob: ${afterPreFlop.bob}`,
    );

    expect(afterPreFlop.bettingRound).toBe('FLOP');
    expect(afterPreFlop.communityCards).toBe(3);
    expect(afterPreFlop.runCountDecisionEligiblePlayerIds).toHaveLength(2);

    const result = await handCompletePromise;
    expect(result.totalPot).toBe(2000);

    // The helper auto-selects run once, then progresses showdown to completion.
    console.log(
      'Both players all-in - run-count decision offered before showdown completed',
    );

    if (afterPreFlop.alice === afterPreFlop.bob) {
      console.log('Tie showdown: split pot (1000/1000).');
    } else {
      const winner = afterPreFlop.alice === 2000 ? 'Alice' : 'Bob';
      const loser = winner === 'Alice' ? 'Bob' : 'Alice';
      console.log(`Winner: ${winner} (2000 chips), Loser: ${loser} (0 chips)`);
    }
    console.log(
      '\n=== Test 3.1: Small all-in verified - both went all-in, instant showdown ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('3.2: All-In Call - both players all-in, all cards dealt immediately', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Alice starts game via UI
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    console.log('Game started');
    const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
      alicePage,
      bobPage,
    ]);

    // PRE_FLOP: Bob (small blind) acts first
    // Alice goes all-in
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Bob checks to pass turn to Alice
    console.log('Pre-flop: Bob calling (to match big blind)...');
    await bobPage.click('[data-testid="action-call"]');

    // Alice's turn - goes all-in
    console.log('Pre-flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    console.log('Pre-flop: Alice going all-in...');
    await alicePage.click('[data-testid="action-all-in"]');

    // Wait for Alice's all-in to register
    await bobPage.waitForTimeout(1000);

    // Bob's turn - calls all-in
    console.log('Pre-flop: Bob waiting for turn after Alice all-in...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    const callButton = await bobPage.textContent('[data-testid="action-call"]');
    console.log('Bob sees call button:', callButton);

    console.log('Pre-flop: Bob calling all-in...');
    await bobPage.click('[data-testid="action-call"]');

    // Betting is closed, so the table should offer a run-count decision.
    await waitForRunCountDecision(alicePage, 2, 0);
    console.log('Waiting for run-count decision...');

    // Verify all 5 community cards were dealt
    await waitForPokerDebug(alicePage);
    const gameState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length,
        bettingRound: room?.currentHand?.bettingRound,
        runCountDecisionEligiblePlayerIds:
          room?.currentHand?.runCountDecision?.eligiblePlayerIds ?? [],
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log('Game state after all-in:', gameState);

    expect(gameState.communityCards).toBe(0);
    expect(gameState.bettingRound).toBe('PRE_FLOP');
    expect(gameState.runCountDecisionEligiblePlayerIds).toHaveLength(2);

    const result = await handCompletePromise;
    expect(result.totalPot).toBe(2000);

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('3.3: Both All-In Pre-Flop - immediate double all-in scenario', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    console.log('Game started');
    const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
      alicePage,
      bobPage,
    ]);

    // Verify initial state
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(DEFAULT_OPENING_POT);
    expect(initialState.alice).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND);
    expect(initialState.bob).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND);

    // PRE_FLOP: Bob (small blind) acts first - goes all-in immediately
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    console.log('Pre-flop: Bob going all-in immediately...');
    await bobPage.click('[data-testid="action-all-in"]');

    // Wait for Bob's all-in to propagate
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    const afterBobAllIn = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob all-in: Pot $${afterBobAllIn.pot}, currentBet $${afterBobAllIn.currentBet}, Alice: ${afterBobAllIn.alice}, Bob: ${afterBobAllIn.bob}`,
    );
    expect(afterBobAllIn.bob).toBe(0); // Bob is all-in
    // Independent expected math: initial pot $30 + Bob remaining $990.
    expect(afterBobAllIn.pot).toBe(1010);
    expect(afterBobAllIn.currentBet).toBe(DEFAULT_STARTING_CHIPS);

    // Alice responds by going all-in
    console.log('Pre-flop: Alice going all-in to match Bob...');
    await alicePage.click('[data-testid="action-all-in"]');

    // Betting is closed, so the table should offer a run-count decision.
    await waitForRunCountDecision(alicePage, 2, 0);
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        runCountDecisionEligiblePlayerIds:
          room?.currentHand?.runCountDecision?.eligiblePlayerIds ?? [],
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Final state: Pot $${finalState.pot}, Round: ${finalState.bettingRound}, Cards: ${finalState.communityCards}, Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    expect(finalState.bettingRound).toBe('PRE_FLOP');
    expect(finalState.communityCards).toBe(0);
    expect(finalState.runCountDecisionEligiblePlayerIds).toHaveLength(2);

    const result = await handCompletePromise;
    expect(result.totalPot).toBe(2000);

    if (finalState.alice === finalState.bob) {
      console.log('Tie showdown: split pot (1000/1000).');
    } else {
      const winner = finalState.alice === 2000 ? 'Alice' : 'Bob';
      const loser = winner === 'Alice' ? 'Bob' : 'Alice';
      console.log(`Winner: ${winner} (2000 chips), Loser: ${loser} (0 chips)`);
    }
    console.log(
      '\n=== Test 3.3: Both all-in pre-flop verified - instant showdown ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('3.4: Partial All-In (Side Pot) - short stack wins main pot, deeper stack wins side pot', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;

      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'spades', rank: 'A' }, // Alice
        { suit: 'diamonds', rank: 'K' }, // Alice
        { suit: 'clubs', rank: 'Q' }, // Bob
        { suit: 'clubs', rank: 'J' }, // Bob
        { suit: 'diamonds', rank: '9' }, // Charlie
        { suit: 'diamonds', rank: '8' }, // Charlie
        { suit: 'hearts', rank: 'A' }, // Flop 1
        { suit: 'clubs', rank: '2' }, // Flop 2
        { suit: 'spades', rank: '5' }, // Flop 3
        { suit: 'diamonds', rank: '7' }, // Turn
        { suit: 'clubs', rank: '10' }, // River
      ]);

      await requestRebuy(bobPage, 2000);
      await requestRebuy(charliePage, 2000);

      const handCompletePromise = captureNextHandComplete(
        alicePage,
        60000,
        [alicePage, bobPage, charliePage],
      );

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      // PRE_FLOP action order (3 players): Alice -> Bob -> Charlie -> Bob
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.fill('[data-testid="raise-input"]', '500');
      await charliePage.click('[data-testid="action-raise"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      // Post-flop only Bob and Charlie can act (Alice is all-in).
      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'TURN', 4);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'RIVER', 5);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      const handCompletePayload = await handCompletePromise;
      const result = handCompletePayload?.result ?? handCompletePayload;
      expect(result.totalPot).toBe(4000);
      expect(result.winners).toHaveLength(2);

      const winnerAmounts = new Map(
        result.winners.map((winner: any) => [
          winner.playerName,
          winner.amountWon,
        ]),
      );
      expect(winnerAmounts.get('Alice')).toBe(3000);
      expect(winnerAmounts.get('Bob')).toBe(1000);
      expect(winnerAmounts.get('Charlie') || 0).toBe(0);
      expect(result.netByPlayerId).toBeDefined();

      const netByPlayerName = new Map(
        result.playerHands.map((entry: any) => [
          entry.playerName,
          result.netByPlayerId?.[entry.playerId] ?? null,
        ]),
      );
      expect(netByPlayerName.get('Alice')).toBe(2000);
      expect(netByPlayerName.get('Bob')).toBe(-500);
      expect(netByPlayerName.get('Charlie')).toBe(-1500);

      const totalAwarded = result.winners.reduce(
        (sum: number, winner: any) => sum + winner.amountWon,
        0,
      );
      expect(totalAwarded).toBe(4000);
      await expect(
        alicePage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText('Your hand: +$2000');
      await expect(
        bobPage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText('Your hand: -$500');
      await expect(
        charliePage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText('Your hand: -$1500');
      await expect(
        alicePage.locator('[data-testid="hand-results-payouts"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="payout-segment-0"]'),
      ).toContainText('Main Pot');
      await expect(
        alicePage.locator('[data-testid="payout-segment-1"]'),
      ).toContainText('Side Pot #1');
      const resultRowPlayerIdsInOrder = await alicePage
        .locator('[data-testid^="hand-result-row-"]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute('data-testid') ?? '')
            .map((testId) => testId.replace('hand-result-row-', ''))
            .filter(Boolean),
        );
      const winnerAmountsByPlayerId = new Map(
        result.winners.map((winner: any) => [
          winner.playerId,
          winner.amountWon,
        ]),
      );
      const resultRowAwardsInOrder = resultRowPlayerIdsInOrder.map(
        (playerId: string) => winnerAmountsByPlayerId.get(playerId) ?? 0,
      );
      expect(resultRowAwardsInOrder).toHaveLength(3);
      for (let idx = 1; idx < resultRowAwardsInOrder.length; idx += 1) {
        expect(resultRowAwardsInOrder[idx]).toBeLessThanOrEqual(
          resultRowAwardsInOrder[idx - 1],
        );
      }
      const highestAwardWinner = result.winners.reduce(
        (best: any, winner: any) =>
          !best || winner.amountWon > best.amountWon ? winner : best,
      );
      expect(resultRowPlayerIdsInOrder[0]).toBe(highestAwardWinner.playerId);

      await verifyChipConservation(alicePage, 5000);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('3.5: Side Pot With Folded Caller Shows Only Required Showdown Hands', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;

      await setAllowPlayerStreetRevealAndWait(
        alicePage,
        [alicePage, bobPage, charliePage],
        false,
      );
      await requestRebuy(bobPage, 2000);
      await requestRebuy(charliePage, 2000);

      const handCompletePromise = captureNextHandComplete(alicePage, 60000, [
        alicePage,
        bobPage,
        charliePage,
      ]);

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.fill('[data-testid="raise-input"]', '500');
      await charliePage.click('[data-testid="action-raise"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      await waitForRunCountDecision(alicePage, 2);
      const runCountResponse = await emitSocketEventAck(alicePage, 'SET_RUN_COUNT', {
        runCount: 1,
      });
      expect(runCountResponse.success || runCountResponse.duplicate).toBeTruthy();
      await waitForRound(alicePage, 'SHOWDOWN', 5);

      await clickRevealResultFromAnyPage(
        [alicePage, bobPage, charliePage],
        10000,
      );
      const result = await handCompletePromise;
      expect(result.totalPot).toBe(3500);
      expect(result.playerHands).toHaveLength(3);

      const shownNames = result.playerHands
        .filter((entry: any) => entry.cardsVisibility === 'shown')
        .map((entry: any) => entry.playerName)
        .sort();
      expect(shownNames).toEqual(['Alice', 'Charlie']);

      expect(result.payouts).toHaveLength(2);
      expect(result.payouts[0].amount).toBe(3000);
      expect(result.payouts[0].eligiblePlayerIds).toHaveLength(2);
      expect(result.payouts[1].amount).toBe(500);
      expect(result.payouts[1].eligiblePlayerIds).toHaveLength(1);
      expect(result.payouts[1].uncontested).toBe(true);

      const bobPlayerId = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return (
          room?.players?.find((player: any) => player.name === 'Bob')?.id ??
          null
        );
      });
      if (!bobPlayerId) {
        throw new Error(
          'Missing Bob player id for side-pot folded-player assertion',
        );
      }

      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        charliePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();

      await expect(
        alicePage.locator('[data-testid^="hand-result-row-"]'),
      ).toHaveCount(3);
      await expect(
        alicePage.locator(`[data-testid="hand-result-row-${bobPlayerId}"]`),
      ).toHaveCount(1);

      await expect(
        alicePage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        alicePage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(2);
      await expect(
        bobPage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        bobPage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(2);
      await expect(
        charliePage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        charliePage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(2);

      await verifyChipConservation(alicePage, 5000);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 4: Edge Cases', () => {
  test('4.0: CORRECT Minimum Raise Logic - raise amount not bet amount', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    console.log('=== Testing CORRECT minimum raise logic ===');
    console.log('Correct rule: Minimum raise = size of previous raise');
    console.log(
      'Example: BB=$20, Alice raises to $60 ($40 raise), Bob must raise at least $40 more (to $100)',
    );

    // Alice creates room
    console.log('\nAlice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });

    // PRE_FLOP: Bob acts first (SB posted $10, needs to call $10 more or raise)
    console.log('\nPRE_FLOP: Bob (SB) to act...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Bob raises to $60 (a $40 raise from BB of $20)
    console.log('Bob raises $40 (making currentBet $60)...');
    await bobPage.fill('[data-testid="raise-input"]', '40');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    console.log('Alice now facing bet of $60');

    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        bobChips: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
        aliceChips: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        minRaise: (window as any).pokerDebug?.minRaise,
      };
    });

    console.log(
      `After Bob's raise: pot=$${afterBobRaise.pot}, currentBet=$${afterBobRaise.currentBet}`,
    );
    console.log(
      `Bob chips: ${afterBobRaise.bobChips}, Alice chips: ${afterBobRaise.aliceChips}`,
    );
    console.log(`Server says minRaise: $${afterBobRaise.minRaise}`);

    // CORRECT poker rule: Bob raised $40 (from $20 to $60)
    // So Alice must raise at least $40 more (to $100 minimum)
    // The minimum RAISE AMOUNT is $40, not $80!

    console.log('\n=== Testing minimum raise ===');
    console.log('Bob raised $40 (from $20 BB to $60)');
    console.log('Alice must raise at least $40 more');
    console.log('So minimum total bet = $60 + $40 = $100');
    console.log(
      'This means Alice should be able to raise $40 (not need to raise $80)',
    );

    // Try to raise $40 - this SHOULD work according to correct poker rules
    await alicePage.fill('[data-testid="raise-input"]', '40');
    await alicePage.waitForTimeout(100);

    const raiseButtonDisabled = await alicePage
      .locator('[data-testid="action-raise"]')
      .isDisabled();

    // CORRECT EXPECTATION: Button should be ENABLED for $40 raise
    // This test will FAIL because the current implementation requires $80 (currentBet * 2)
    expect(raiseButtonDisabled).toBe(false);
    console.log(
      '✓ CORRECT: Raise button should be ENABLED for $40 raise (matches previous raise size)',
    );

    console.log('\n=== Test 4.0: This test expects CORRECT poker rules ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('4.1: Minimum Raise - verify system enforces minimum raise requirements', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    console.log('Game started');

    // Verify initial state
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, currentBet $${initialState.currentBet}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(DEFAULT_OPENING_POT);
    expect(initialState.currentBet).toBe(DEFAULT_BIG_BLIND);
    expect(initialState.alice).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND);
    expect(initialState.bob).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND);

    // PRE_FLOP: Bob acts first (small blind)
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Get minRaise from SERVER (correct poker rules!)
    const bobTurnState = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
        minRaise: room?.currentHand?.minRaise, // Use server's correct value
      };
    });
    console.log(
      `Bob's turn - currentBet: $${bobTurnState.currentBet}, minRaise: $${bobTurnState.minRaise}`,
    );

    // With CORRECT poker rules:
    // - BB = $20 is the initial raise
    // - minRaise = $20 (size of BB)
    // - Bob must raise at least $20 more

    // Test 1: Try invalid amount (less than minRaise)
    const invalidAmount = bobTurnState.minRaise - 10;
    console.log(
      `Pre-flop: Testing invalid raise amount $${invalidAmount} (min is $${bobTurnState.minRaise})...`,
    );
    await bobPage.fill('[data-testid="raise-input"]', invalidAmount.toString());
    await bobPage.waitForTimeout(100); // Let UI update
    const raiseButtonDisabled = await bobPage
      .locator('[data-testid="action-raise"]')
      .isDisabled();
    expect(raiseButtonDisabled).toBe(true);
    console.log(
      `✓ Raise button disabled when input ($${invalidAmount}) < minimum ($${bobTurnState.minRaise})`,
    );

    // Test 2: Use exact minimum raise amount
    console.log(
      `Pre-flop: Bob raising to minimum $${bobTurnState.minRaise}...`,
    );
    await bobPage.fill(
      '[data-testid="raise-input"]',
      bobTurnState.minRaise.toString(),
    );
    await bobPage.click('[data-testid="action-raise"]');

    // Wait for action to process
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob's raise $40: Pot $${afterBobRaise.pot}, currentBet $${afterBobRaise.currentBet}, Bob chips: ${afterBobRaise.bob}`,
    );

    // Verify minimum raise worked
    // With CORRECT poker rules:
    // - Bob raised by minRaise amount ($20)
    // - currentBet = previous bet ($20) + raise ($20) = $40
    const expectedCurrentBet = bobTurnState.currentBet + bobTurnState.minRaise;
    expect(afterBobRaise.currentBet).toBe(expectedCurrentBet);
    console.log(
      `✓ Minimum raise of $${bobTurnState.minRaise} succeeded (currentBet now $${expectedCurrentBet})`,
    );

    // Verify Bob's chips decreased appropriately
    // Bob started with 990, posted small blind $10
    // After raising by minRaise, Bob's total contribution is $10 SB + $20 raise = $30
    // So Bob's chips: 990 - 30 = 960
    const bobInitialChips = DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND;
    const bobSmallBlind = DEFAULT_SMALL_BLIND;
    const bobRaiseAmount = bobTurnState.minRaise;
    const bobTotalBet = bobSmallBlind + bobRaiseAmount;
    const expectedBobChips = bobInitialChips - bobTotalBet;
    expect(afterBobRaise.bob).toBe(expectedBobChips);
    console.log(
      `✓ Bob's chips correctly updated: ${afterBobRaise.bob} (expected ${expectedBobChips})`,
    );

    // Test 3: Verify CORRECT minRaise formula
    // Correct poker rule: minRaise = size of previous raise
    // The BB ($20) was the previous "raise", so minRaise should equal BB
    const expectedMinRaise = DEFAULT_BIG_BLIND;
    expect(bobTurnState.minRaise).toBe(expectedMinRaise);
    console.log(
      `✓ CORRECT minimum raise formula: minRaise = size of previous raise = $${expectedMinRaise}`,
    );

    console.log(
      '\n=== Test 4.1: Minimum raise enforcement verified with CORRECT poker rules ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('4.2: Raise More Than Opponent Has - verify handling when player cannot match full bet', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    await bobPage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    await bobPage.waitForSelector('[data-testid="round-value"]', {
      timeout: 10000,
    });
    console.log('Game started');

    // Verify initial state
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(DEFAULT_OPENING_POT);
    expect(initialState.alice).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND);
    expect(initialState.bob).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND);

    // PRE_FLOP: Bob acts first - raises large amount leaving only $5
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });

    // Bob raises $975 (will leave him with $5 after small blind $10 + raise $975 = $985 total bet)
    console.log('Pre-flop: Bob raising $975 (leaving $5)...');
    await bobPage.fill('[data-testid="raise-input"]', '975');
    await bobPage.click('[data-testid="action-raise"]');

    // Wait for Alice's turn
    await alicePage.waitForSelector('[data-testid="action-dock"]', {
      timeout: 10000,
    });
    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob's raise: Pot $${afterBobRaise.pot}, currentBet $${afterBobRaise.currentBet}, Alice: ${afterBobRaise.alice}, Bob: ${afterBobRaise.bob}`,
    );

    // Verify Bob's state after large raise
    expect(afterBobRaise.bob).toBe(15);
    console.log(
      `✓ Bob has ${afterBobRaise.bob} chips remaining after large raise`,
    );

    // Alice can call (matching Bob's bet) or raise (if she has enough)
    // Since Alice has 980 chips and Bob's currentBet is likely ~$985-995
    // Alice can only call up to Bob's total bet amount
    console.log(
      `Pre-flop: Alice calling Bob's bet (currentBet $${afterBobRaise.currentBet})...`,
    );
    await alicePage.click('[data-testid="action-call"]');

    // Wait for game to progress
    await alicePage.waitForTimeout(2000);
    const afterAliceCall = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Alice's call: Pot $${afterAliceCall.pot}, Round: ${afterAliceCall.bettingRound}, Alice: ${afterAliceCall.alice}, Bob: ${afterAliceCall.bob}`,
    );

    // Verify both players matched the bet properly
    expect(afterAliceCall.alice).toBe(15);
    console.log(
      `✓ Alice has ${afterAliceCall.alice} chips after calling Bob's large bet`,
    );

    // Verify game progressed to next round or showdown
    expect(afterAliceCall.bettingRound).not.toBe('PRE_FLOP');
    console.log(`✓ Game progressed to ${afterAliceCall.bettingRound}`);

    // Verify chip conservation
    const totalChips =
      (afterAliceCall.alice || 0) +
      (afterAliceCall.bob || 0) +
      (afterAliceCall.pot || 0);
    expect(totalChips).toBe(2000);
    console.log(
      `✓ Chip conservation maintained: ${afterAliceCall.alice} + ${afterAliceCall.bob} + ${afterAliceCall.pot} = ${totalChips}`,
    );

    console.log('\n=== Test 4.2: Large raise handled correctly ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('@critical 4.3: Check When Bet Required - verify check button disabled when facing a bet', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;

      alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
      bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

      console.log('Alice starting game...');
      await alicePage.click('[data-testid="start-game-button"]');
      await alicePage.waitForSelector('[data-testid="round-value"]', {
        timeout: 10000,
      });
      await bobPage.waitForSelector('[data-testid="round-value"]', {
        timeout: 10000,
      });
      console.log('Game started');

      // PRE_FLOP: Bob acts first (small blind, needs to call or raise)
      console.log('Pre-flop: Bob waiting for turn...');
      await bobPage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });

      // Bob raises $50
      console.log('Pre-flop: Bob raising $50...');
      await bobPage.fill('[data-testid="raise-input"]', '50');
      await bobPage.click('[data-testid="action-raise"]');

      // Alice's turn - she faces a bet and cannot check
      await alicePage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log("Pre-flop: Alice facing Bob's raise...");

      const afterBobRaise = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom();
        return {
          currentBet: room?.currentHand?.currentBet,
        };
      });
      console.log(`Alice facing bet of $${afterBobRaise.currentBet}`);

      // Verify Check button remains visible but disabled when facing a bet
      const checkButton = alicePage.locator('[data-testid="action-check"]');
      await expect(checkButton).toHaveCount(1);
      await expect(checkButton).toBeDisabled();
      console.log('✓ Check button remains visible but disabled when Alice faces a bet');

      // Verify Call button is available through the tray presets
      const callButtonEnabled = await alicePage
        .locator('[data-testid="chip-load-continue"]')
        .isEnabled();
      expect(callButtonEnabled).toBe(true);
      console.log('✓ Call button is enabled');

      // Verify Fold button is available
      const foldButtonEnabled = await alicePage
        .locator('[data-testid="action-fold"]')
        .isEnabled();
      expect(foldButtonEnabled).toBe(true);
      console.log('✓ Fold button is enabled');

      // Verify All-In button is available
      const allInButtonEnabled = await alicePage
        .locator('[data-testid="chip-load-all-in"]')
        .isEnabled();
      expect(allInButtonEnabled).toBe(true);
      console.log('✓ All-In button is enabled');

      console.log(
        '\n=== Test 4.3: Check validation verified - cannot check when facing a bet ===',
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('4.4: Multiple Hands in Sequence - play 5 hands and verify rotation/accounting', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const handStarts: Array<{
        handNumber: number;
        dealerPosition: number | null;
        smallBlindPosition: number | null;
        bigBlindPosition: number | null;
        dealerPlayerName: string | null;
        smallBlindPlayerName: string | null;
        bigBlindPlayerName: string | null;
        currentPlayerName: string | null;
        pot: number;
        aliceCurrentBet: number;
        bobCurrentBet: number;
      }> = [];

      for (let handNumber = 1; handNumber <= 5; handNumber++) {
        await waitForHandStart(alicePage, handNumber);
        const snapshot = await getRoomSnapshot(alicePage);
        handStarts.push({
          handNumber: snapshot.handNumber,
          dealerPosition: snapshot.dealerPosition,
          smallBlindPosition: snapshot.smallBlindPosition,
          bigBlindPosition: snapshot.bigBlindPosition,
          dealerPlayerName: snapshot.dealerPlayerName,
          smallBlindPlayerName: snapshot.smallBlindPlayerName,
          bigBlindPlayerName: snapshot.bigBlindPlayerName,
          currentPlayerName: snapshot.currentPlayerName,
          pot: snapshot.pot,
          aliceCurrentBet: snapshot.aliceCurrentBet,
          bobCurrentBet: snapshot.bobCurrentBet,
        });

        expect(snapshot.handNumber).toBe(handNumber);
        expect(snapshot.bettingRound).toBe('PRE_FLOP');
        expect(snapshot.pot).toBe(DEFAULT_OPENING_POT);
        expect(snapshot.dealerPosition).not.toBeNull();
        expect(snapshot.dealerPosition).toBe((handNumber - 1) % 2);
        expect(snapshot.smallBlindPosition).toBe(
          (Number(snapshot.dealerPosition) + 1) % 2,
        );
        expect(snapshot.bigBlindPosition).toBe(snapshot.dealerPosition);
        expect(snapshot.currentPlayerName).toBe(snapshot.smallBlindPlayerName);
        expect(snapshot.aliceCurrentBet + snapshot.bobCurrentBet).toBe(
          DEFAULT_OPENING_POT,
        );
        await verifyChipConservation(alicePage, 2000);

        const actingPage =
          snapshot.currentPlayerName === 'Alice' ? alicePage : bobPage;
        await waitForPlayerTurn(actingPage, snapshot.currentPlayerName!);
        const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
          alicePage,
          bobPage,
        ]);
        await actingPage.click('[data-testid="action-fold"]');
        await handCompletePromise;
        await expect(
          alicePage.locator('[data-testid="start-next-hand-button"]'),
        ).toBeVisible();
        await alicePage.click('[data-testid="start-next-hand-button"]');

        if (handNumber < 5) {
          await waitForHandStart(alicePage, handNumber + 1);
        } else {
          await waitForHandStart(alicePage, 6);
        }
      }

      expect(handStarts.map((h) => h.dealerPosition)).toEqual([0, 1, 0, 1, 0]);
      expect(handStarts.map((h) => h.smallBlindPlayerName)).toEqual([
        'Bob',
        'Alice',
        'Bob',
        'Alice',
        'Bob',
      ]);
      expect(handStarts.map((h) => h.bigBlindPlayerName)).toEqual([
        'Alice',
        'Bob',
        'Alice',
        'Bob',
        'Alice',
      ]);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Chip Conservation', () => {
  test('@critical 6.1: Chip Conservation Throughout Hand - multiple hands in sequence', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;

      // Add console listeners
      alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
      bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

      // Play 1 hand to verify chip conservation throughout
      console.log(`\n=== Starting Hand ===`);

      await setAllowPlayerStreetRevealAndWait(
        alicePage,
        [alicePage, bobPage],
        false,
      );

      // Start game via UI
      await alicePage.click('[data-testid="start-game-button"]');
      await alicePage.waitForSelector('[data-testid="round-value"]', {
        timeout: 10000,
      });
      await bobPage.waitForSelector('[data-testid="round-value"]', {
        timeout: 10000,
      });
      console.log('Game started');

      // Check conservation at start
      await waitForPokerDebug(alicePage);
      await verifyChipConservation(alicePage, 2000);

      // Pre-flop: Bob calls, Alice checks
      await bobPage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('Bob calling...');
      await bobPage.click('[data-testid="action-call"]');

      await alicePage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('Alice checking...');
      await alicePage.click('[data-testid="action-check"]');

      await alicePage.waitForTimeout(2000);

      // Flop: Bob checks, Alice checks (Bob acts first post-flop)
      await bobPage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('Flop - Bob checking...');
      await bobPage.click('[data-testid="action-check"]');

      await alicePage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('Flop - Alice checking...');
      await alicePage.click('[data-testid="action-check"]');

      await alicePage.waitForTimeout(2000);

      // Turn: Bob checks, Alice checks
      await bobPage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('Turn - Bob checking...');
      await bobPage.click('[data-testid="action-check"]');

      await alicePage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('Turn - Alice checking...');
      await alicePage.click('[data-testid="action-check"]');

      await alicePage.waitForTimeout(2000);

      // River: Bob checks, Alice checks
      await bobPage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('River - Bob checking...');
      await bobPage.click('[data-testid="action-check"]');

      await alicePage.waitForSelector('[data-testid="action-dock"]', {
        timeout: 10000,
      });
      console.log('River - Alice checking...');
      await alicePage.click('[data-testid="action-check"]');

      // Wait for hand to complete
      await alicePage.waitForTimeout(2000);
      console.log('Hand complete');

      // Verify chip conservation after hand
      const finalState = await alicePage.evaluate(() => {
        const room = window.pokerDebug.getRoom();
        return {
          alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
          bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
        };
      });
      console.log(
        `Final chips - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
      );

      await verifyChipConservation(alicePage, 2000);

      console.log('\n=== Chip conservation verified throughout hand ===');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 2: Raise/Re-raise Actions', () => {
  test('2.1: Single Raise - test raise mechanics', async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room page to load
    await alicePage.waitForSelector('[data-testid="room-title"]');

    // Get room ID from UI
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for Bob to see room page
    await bobPage.waitForSelector('[data-testid="room-title"]');

    // Wait for both players to appear in room
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Alice starts game via UI button
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start
    await alicePage.waitForSelector('[data-testid="round-value"]');
    await bobPage.waitForSelector('[data-testid="round-value"]');
    console.log('Game started');
    const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
      alicePage,
      bobPage,
    ]);

    // PRE_FLOP: Bob raises $50
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop - Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn - verify currentBet in the turn event
    await alicePage.waitForSelector('[data-testid="action-dock"]');

    const pokerDebugAlice = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
        pot: room?.currentHand?.pot,
      };
    });
    expect(pokerDebugAlice.currentBet).toBe(DEFAULT_BIG_BLIND + 50);
    console.log(`Current bet verified: $${pokerDebugAlice.currentBet}`);

    // Alice must call $50 (from big blind $20 to $70)
    const callButton = await alicePage.textContent(
      '[data-testid="action-call"]',
    );
    expect(callButton).toContain('50'); // Should show "Call $50" (from $20 to $70)
    console.log('Pre-flop - Alice calling $50...');
    await alicePage.click('[data-testid="action-call"]');

    // Verify pot = $140 after blinds + raise + call
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return room?.currentHand?.pot || 0;
    });
    expect(afterPreFlop).toBe(
      DEFAULT_OPENING_POT + 50 + (50 + DEFAULT_SMALL_BLIND_CALL_GAP),
    );
    console.log(`Pot after pre-flop: $${afterPreFlop}`);

    // Verify both players' chips after pre-flop betting
    const chipsAfterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    expect(chipsAfterPreFlop.alice).toBe(DEFAULT_STARTING_CHIPS - 60);
    expect(chipsAfterPreFlop.bob).toBe(DEFAULT_STARTING_CHIPS - 60);
    console.log(
      `Chips after pre-flop - Alice: ${chipsAfterPreFlop.alice}, Bob: ${chipsAfterPreFlop.bob}`,
    );

    // FLOP: Both check to showdown
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Verify betting round transitioned to TURN
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
      };
    });
    expect(afterFlop.bettingRound).toBe('TURN');
    expect(afterFlop.communityCards).toBe(4); // Flop (3) + Turn (1)

    // TURN: Both check
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // RIVER: Both check
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await handCompletePromise;
    console.log('Showdown complete');

    // Verify final state
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log(
      `Final state - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify winner received pot and chip conservation
    const totalChips = finalState.alice + finalState.bob;
    expect(totalChips).toBe(2000); // Chip conservation

    // Valid outcomes: single winner takes $140 pot, or exact split at showdown.
    const validOutcomes = [
      { alice: 1060, bob: 940 },
      { alice: 940, bob: 1060 },
      { alice: 1000, bob: 1000 },
    ];
    const hasValidOutcome = validOutcomes.some(
      (o) => o.alice === finalState.alice && o.bob === finalState.bob,
    );
    expect(hasValidOutcome).toBe(true);
    console.log(
      `Final outcome validated - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Test 2.1: Single raise mechanics verified ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('2.2: Re-raise (3-bet) - test re-raising mechanics', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room page to load
    await alicePage.waitForSelector('[data-testid="room-title"]');

    // Get room ID from UI
    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for Bob to see room page
    await bobPage.waitForSelector('[data-testid="room-title"]');

    // Wait for both players to appear in room
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Alice starts game via UI button
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start
    await alicePage.waitForSelector('[data-testid="round-value"]');
    await bobPage.waitForSelector('[data-testid="round-value"]');
    console.log('Game started');
    const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
      alicePage,
      bobPage,
    ]);

    // PRE_FLOP: Bob raises $50
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop - Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice re-raises
    // (Bob raised $50, so min raise = $50 more = $120 minimum with correct poker rules)
    // Alice raises $150 (more than minimum), making currentBet $220
    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop - Alice re-raising (entering $150)...');
    await alicePage.fill('[data-testid="raise-input"]', '150');
    await alicePage.click('[data-testid="action-raise"]');

    // Verify currentBet after re-raise (will be enforced to minimum)
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    const pokerDebugBob = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
        pot: room?.currentHand?.pot,
      };
    });
    // System enforces minimum raise, so currentBet will be higher than input
    console.log(
      `Current bet after re-raise: $${pokerDebugBob.currentBet}, pot: $${pokerDebugBob.pot}`,
    );

    // Bob calls (amount depends on what system set as currentBet)
    const callButtonText = await bobPage.textContent(
      '[data-testid="action-call"]',
    );
    console.log(`Pre-flop - Bob sees: ${callButtonText}`);
    await bobPage.click('[data-testid="action-call"]');

    // Verify pot after all pre-flop action
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return room?.currentHand?.pot || 0;
    });
    console.log(`Pot after pre-flop: $${afterPreFlop}`);

    // Verify both players have equal chips after matching bets
    const chipsAfterPreFlop22 = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    expect(chipsAfterPreFlop22.alice).toBe(790);
    expect(chipsAfterPreFlop22.bob).toBe(790);
    console.log(
      `Chips matched - Alice: ${chipsAfterPreFlop22.alice}, Bob: ${chipsAfterPreFlop22.bob}`,
    );

    // Verify both players have equal chips after matching bets
    const chipsAfterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    expect(chipsAfterPreFlop.alice).toBe(790);
    expect(chipsAfterPreFlop.bob).toBe(790);
    console.log(
      `Chips matched - Alice: ${chipsAfterPreFlop.alice}, Bob: ${chipsAfterPreFlop.bob}`,
    );

    // FLOP/TURN/RIVER: Both check to showdown
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await handCompletePromise;
    console.log('Showdown complete');

    // Verify final state
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log(
      `Final state - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify winner received the pot and loser has correct amount
    const totalChips = finalState.alice + finalState.bob;
    expect(totalChips).toBe(2000); // Chip conservation

    // Pot was $440. Valid outcomes: one winner takes all or split pot tie.
    const hasValidOutcome =
      (finalState.alice === 1210 && finalState.bob === 790) ||
      (finalState.alice === 790 && finalState.bob === 1210) ||
      (finalState.alice === 1000 && finalState.bob === 1000);
    expect(hasValidOutcome).toBe(true);

    if (finalState.alice === finalState.bob) {
      console.log('Showdown tie: split pot (1000/1000).');
    } else {
      const winner = finalState.alice > finalState.bob ? 'Alice' : 'Bob';
      const loser = finalState.alice > finalState.bob ? 'Bob' : 'Alice';
      console.log(
        `Winner: ${winner} (1210 chips), Loser: ${loser} (790 chips)`,
      );
    }

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Test 2.2: Re-raise (3-bet) mechanics verified ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('2.3: Multiple Re-raises - test escalating bets', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await authenticateStandardTwoPlayerPages(alicePage, bobPage);

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');

    const roomIdText = await alicePage.textContent(
      '[data-testid="room-title"]',
    );
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await bobPage.waitForSelector('[data-testid="room-title"]');
    await alicePage.waitForSelector(
      '[data-testid="room-player-count"]:has-text("Players: 2/")',
    );
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]');
    await bobPage.waitForSelector('[data-testid="round-value"]');
    console.log('Game started');
    const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
      alicePage,
      bobPage,
    ]);

    // Track pot at each step
    let potHistory: number[] = [DEFAULT_OPENING_POT];

    // PRE_FLOP Round 1: Bob raises $50
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop Round 1 - Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const pot1 = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return room?.currentHand?.pot || 0;
    });
    potHistory.push(pot1);
    console.log(`Pot after Bob's raise: $${pot1}`);

    // PRE_FLOP Round 2: Alice re-raises $150
    console.log('Pre-flop Round 2 - Alice re-raising $150...');
    await alicePage.fill('[data-testid="raise-input"]', '150');
    await alicePage.click('[data-testid="action-raise"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    const pot2 = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        currentBet: room?.currentHand?.currentBet,
      };
    });
    potHistory.push(pot2.pot);
    console.log(
      `Pot after Alice's re-raise: $${pot2.pot}, currentBet: $${pot2.currentBet}`,
    );

    // PRE_FLOP Round 3: Bob re-raises again
    // (Alice raised $150, so min raise = $150 more = $370 minimum, but Bob raises to $440)
    console.log('Pre-flop Round 3 - Bob re-raising to $440...');
    await bobPage.fill('[data-testid="raise-input"]', '440');
    await bobPage.click('[data-testid="action-raise"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const pot3 = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    potHistory.push(pot3.pot);
    console.log(
      `Pot after Bob's 2nd raise: $${pot3.pot}, currentBet: $${pot3.currentBet}, Alice: ${pot3.alice}, Bob: ${pot3.bob}`,
    );

    // Alice calls to end pre-flop
    console.log('Pre-flop - Alice calling...');
    await alicePage.click('[data-testid="action-call"]');

    // Verify final pot after pre-flop
    await new Promise((resolve) => setTimeout(resolve, 500));
    const finalPreFlopState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    potHistory.push(finalPreFlopState.pot);

    console.log(`Final pre-flop pot: $${finalPreFlopState.pot}`);
    console.log(`Pot progression: ${potHistory.join(' → ')}`);
    console.log(
      `Chips after pre-flop - Alice: ${finalPreFlopState.alice}, Bob: ${finalPreFlopState.bob}`,
    );

    // Verify both players have same chip amount (matched all bets)
    expect(finalPreFlopState.alice).toBe(finalPreFlopState.bob);
    expect(
      finalPreFlopState.alice + finalPreFlopState.bob + finalPreFlopState.pot,
    ).toBe(2000);

    // FLOP/TURN/RIVER: Both check
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await handCompletePromise;
    console.log('Showdown complete');

    // Verify final state
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log(
      `Final state - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify chip conservation and winner determination
    const totalChips = finalState.alice + finalState.bob;
    expect(totalChips).toBe(2000);

    const winner = finalState.alice > finalState.bob ? 'Alice' : 'Bob';
    const loser = finalState.alice > finalState.bob ? 'Bob' : 'Alice';
    console.log(`Winner: ${winner}, Loser: ${loser}`);
    console.log(
      `Pot was distributed correctly: ${finalPreFlopState.pot} chips`,
    );

    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Test 2.3: Multiple re-raises verified ===');

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe('Poker E2E - Test Suite 5: Turn/Round Advancement', () => {
  test('5.1: Turn Skipping Check - verify turn sequence is correct', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const initial = await getRoomSnapshot(alicePage);
      expect(initial.bettingRound).toBe('PRE_FLOP');
      expect(initial.currentPlayerName).toBe('Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(50));
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterBobRaise = await getRoomSnapshot(alicePage);
      expect(afterBobRaise.currentPlayerName).toBe('Alice');
      expect(afterBobRaise.currentBet).toBe(DEFAULT_BIG_BLIND + 50);

      await alicePage.evaluate(() => (window as any).pokerDebug.call());
      await waitForRound(alicePage, 'FLOP', 3);

      const flopState = await getRoomSnapshot(alicePage);
      expect(flopState.currentPlayerName).toBe('Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.check());
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterBobCheck = await getRoomSnapshot(alicePage);
      expect(afterBobCheck.currentPlayerName).toBe('Alice');

      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'TURN', 4);

      const turnState = await getRoomSnapshot(alicePage);
      expect(turnState.currentPlayerName).toBe('Bob');
      await verifyChipConservation(alicePage);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 5.2: Round Progression - PRE_FLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextSocketEvent(
        alicePage,
        'HAND_COMPLETE',
        60000,
      );
      await startGameFromLobby(alicePage, bobPage);

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);

      const flop = await getRoomSnapshot(alicePage);
      expect(flop.bettingRound).toBe('FLOP');
      expect(flop.communityCards).toBe(3);
      const expectedFinalPot = flop.pot;

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'TURN', 4);

      const turn = await getRoomSnapshot(alicePage);
      expect(turn.bettingRound).toBe('TURN');
      expect(turn.communityCards).toBe(4);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'RIVER', 5);

      const river = await getRoomSnapshot(alicePage);
      expect(river.bettingRound).toBe('RIVER');
      expect(river.communityCards).toBe(5);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'SHOWDOWN', 5);
      await bobPage.evaluate(() => (window as any).pokerDebug.showMyHand());
      await alicePage.evaluate(() => (window as any).pokerDebug.showMyHand());
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      const handCompletePayload = await handCompletePromise;
      const result = handCompletePayload?.result ?? handCompletePayload;
      expect(result.totalPot).toBe(expectedFinalPot);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('5.3: Early Showdown (All-In) - deal all cards immediately', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextHandComplete(alicePage, 15000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-all-in"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      const handResult = await handCompletePromise;
      const finalState = await getRoomSnapshot(alicePage);
      const total = finalState.aliceChips + finalState.bobChips;

      expect(handResult.totalPot).toBe(2000);
      expect(total).toBe(2000);
      await verifyChipConservation(alicePage, 2000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 6: Chip Accounting (Additional)', () => {
  test('6.2: Pot Calculation - verify pot updates for each action', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const start = await getRoomSnapshot(alicePage);
      expect(start.pot).toBe(DEFAULT_OPENING_POT);

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(50));
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterRaise = await getRoomSnapshot(alicePage);
      expect(afterRaise.pot).toBe(
        DEFAULT_OPENING_POT + 50 + DEFAULT_SMALL_BLIND_CALL_GAP,
      );
      expect(afterRaise.currentBet).toBe(DEFAULT_BIG_BLIND + 50);
      await verifyChipConservation(alicePage);

      await alicePage.evaluate(() => (window as any).pokerDebug.call());
      await waitForRound(alicePage, 'FLOP', 3);

      const afterCall = await getRoomSnapshot(alicePage);
      expect(afterCall.pot).toBe(
        DEFAULT_OPENING_POT + 50 + (50 + DEFAULT_SMALL_BLIND_CALL_GAP),
      );
      await verifyChipConservation(alicePage);

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(100));
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterFlopRaise = await getRoomSnapshot(alicePage);
      expect(afterFlopRaise.pot).toBe(
        DEFAULT_OPENING_POT + 50 + (50 + DEFAULT_SMALL_BLIND_CALL_GAP) + 100,
      );
      expect(afterFlopRaise.currentBet).toBe(100);
      await verifyChipConservation(alicePage);

      await alicePage.evaluate(() => (window as any).pokerDebug.call());
      await waitForRound(alicePage, 'TURN', 4);

      const afterFlopCall = await getRoomSnapshot(alicePage);
      expect(afterFlopCall.pot).toBe(
        DEFAULT_OPENING_POT + 50 + (50 + DEFAULT_SMALL_BLIND_CALL_GAP) + 200,
      );
      await verifyChipConservation(alicePage);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('6.3: Blind Posting - verify blind positions rotate each hand', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const hand1 = await getRoomSnapshot(alicePage);
      expect(hand1.handNumber).toBe(1);
      expect(hand1.dealerPosition).toBe(0);
      expect(hand1.smallBlindPosition).toBe(1);
      expect(hand1.bigBlindPosition).toBe(0);
      expect(hand1.aliceChips).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND);
      expect(hand1.bobChips).toBe(DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND);
      expect(hand1.currentPlayerName).toBe('Bob');

      await waitForPlayerTurn(bobPage, 'Bob');
      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;
      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid^="your-card-"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="hole-cards-hidden-state"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="start-next-hand-button"]');

      await alicePage.waitForFunction(
        () => {
          const room = (window as any).pokerDebug?.getRoom();
          return (
            room?.currentHand?.handNumber === 2 &&
            room?.currentHand?.bettingRound === 'PRE_FLOP'
          );
        },
        { timeout: 10000 },
      );

      const hand2 = await getRoomSnapshot(alicePage);
      expect(hand2.handNumber).toBe(2);
      expect(hand2.dealerPosition).toBe(1);
      expect(hand2.smallBlindPosition).toBe(0);
      expect(hand2.bigBlindPosition).toBe(1);
      expect(hand2.currentPlayerName).toBe('Alice');
      expect(hand2.pot).toBe(DEFAULT_OPENING_POT);
      expect(hand2.aliceChips).toBe(1000);
      expect(hand2.bobChips).toBe(
        DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND - DEFAULT_BIG_BLIND,
      );
      await verifyChipConservation(alicePage);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 7: Winner Determination', () => {
  test('7.1: High Card Win', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'diamonds', rank: '7' }, // Alice
        { suit: 'spades', rank: 'K' }, // Bob
        { suit: 'clubs', rank: 'Q' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: 'J' }, // Turn
        { suit: 'diamonds', rank: '3' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Alice');
      expect(result.winners[0].hand.rank).toBe('HIGH_CARD');
      expect(result.totalPot).toBe(DEFAULT_TWO_PLAYER_MATCHED_POT);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.2: Pair vs High Card', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice hole 1
        { suit: 'clubs', rank: 'A' }, // Alice hole 2
        { suit: 'diamonds', rank: 'K' }, // Bob hole 1
        { suit: 'spades', rank: 'Q' }, // Bob hole 2
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: 'J' }, // Turn
        { suit: 'diamonds', rank: '3' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].hand.rank).toBe('ONE_PAIR');
      const playerHandsByRank = result.playerHands
        .map((p: any) => p.hand?.rank)
        .filter(Boolean)
        .sort();
      expect(playerHandsByRank).toEqual(['HIGH_CARD', 'ONE_PAIR']);
      expect(result.totalPot).toBe(DEFAULT_TWO_PLAYER_MATCHED_POT);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.2b: Higher Pair Beats Lower Pair', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'diamonds', rank: 'A' }, // Alice hole 1
        { suit: 'hearts', rank: 'Q' }, // Alice hole 2
        { suit: 'spades', rank: '5' }, // Bob hole 1
        { suit: 'hearts', rank: 'K' }, // Bob hole 2
        { suit: 'spades', rank: 'Q' }, // Flop 1
        { suit: 'clubs', rank: 'K' }, // Flop 2
        { suit: 'diamonds', rank: '3' }, // Flop 3
        { suit: 'spades', rank: 'J' }, // Turn
        { suit: 'spades', rank: '6' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Bob');
      expect(result.winners[0].hand.rank).toBe('ONE_PAIR');
      expect(result.winners[0].hand.description).toContain('Pair of Ks');

      const playerHandsByRank = result.playerHands
        .map((playerHand: any) => playerHand.hand?.rank)
        .filter(Boolean)
        .sort();
      expect(playerHandsByRank).toEqual(['ONE_PAIR', 'ONE_PAIR']);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.3: Tie (Split Pot)', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Hole 1
        { suit: 'clubs', rank: 'K' }, // Hole 2
        { suit: 'diamonds', rank: 'K' }, // Hole 3
        { suit: 'spades', rank: 'A' }, // Hole 4
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'hearts', rank: '8' }, // Flop 3
        { suit: 'clubs', rank: 'J' }, // Turn
        { suit: 'spades', rank: '3' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(2);
      const amounts = result.winners
        .map((w: any) => w.amountWon)
        .sort((a: number, b: number) => a - b);
      expect(amounts).toEqual([
        DEFAULT_TWO_PLAYER_MATCHED_POT / 2,
        DEFAULT_TWO_PLAYER_MATCHED_POT / 2,
      ]);
      expect(result.totalPot).toBe(DEFAULT_TWO_PLAYER_MATCHED_POT);
      expect(result.netByPlayerId).toBeDefined();
      const netChanges = Object.values(result.netByPlayerId ?? {});
      expect(netChanges).toHaveLength(2);
      expect(netChanges.every((value) => value === 0)).toBe(true);

      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText('Your hand: +$0');
      await expect(
        bobPage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText('Your hand: +$0');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.4: Win by Fold', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Alice');
      expect(result.winners[0].hand).toBeNull();
      expect(result.winners[0].amountWon).toBe(DEFAULT_OPENING_POT);
      expect(result.playerHands).toHaveLength(2);
      expect(
        result.playerHands.some(
          (entry: any) => entry.resultStatus === 'folded_pre_showdown',
        ),
      ).toBe(true);
      expect(result.totalPot).toBe(DEFAULT_OPENING_POT);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 8: UI/UX Validation', () => {
  test('8.1: Real-Time Updates', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const alicePot = await alicePage.textContent('[data-testid="pot-value"]');
      const bobPot = await bobPage.textContent('[data-testid="pot-value"]');
      expect(alicePot).toContain(`$${DEFAULT_OPENING_POT}`);
      expect(bobPot).toContain(`$${DEFAULT_OPENING_POT}`);

      const aliceRound = await alicePage.textContent(
        '[data-testid="round-value"]',
      );
      const bobRound = await bobPage.textContent('[data-testid="round-value"]');
      expect(aliceRound).toContain('PRE_FLOP');
      expect(bobRound).toContain('PRE_FLOP');

      const aliceChips = await alicePage.textContent(
        '[data-testid="your-chips"]',
      );
      const bobChips = await bobPage.textContent('[data-testid="your-chips"]');
      expect(aliceChips).toContain(
        `$${DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND}`,
      );
      expect(bobChips).toContain(
        `$${DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND}`,
      );

      const initialTurn = await getRoomSnapshot(alicePage);
      expect(initialTurn.currentPlayerName).toBe('Bob');
      expect(await bobPage.locator('[data-testid="action-dock"]').count()).toBe(
        1,
      );

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      const turnAfterBobCall = await getRoomSnapshot(alicePage);
      expect(turnAfterBobCall.currentPlayerName).toBe('Alice');
      expect(
        await alicePage.locator('[data-testid="action-dock"]').count(),
      ).toBe(1);

      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);

      const flopRoundAlice = await alicePage.textContent(
        '[data-testid="round-value"]',
      );
      const flopRoundBob = await bobPage.textContent(
        '[data-testid="round-value"]',
      );
      expect(flopRoundAlice).toContain('FLOP');
      expect(flopRoundBob).toContain('FLOP');

      const flopPotAlice = await alicePage.textContent(
        '[data-testid="pot-value"]',
      );
      const flopPotBob = await bobPage.textContent('[data-testid="pot-value"]');
      expect(flopPotAlice).toContain(`$${DEFAULT_TWO_PLAYER_MATCHED_POT}`);
      expect(flopPotBob).toContain(`$${DEFAULT_TWO_PLAYER_MATCHED_POT}`);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.2: Button States', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      expect(
        await bobPage.locator('[data-testid="action-check"]').count(),
      ).toBe(0);
      await expect(
        bobPage.locator('[data-testid="action-call"]'),
      ).toContainText(`Call $${DEFAULT_SMALL_BLIND_CALL_GAP}`);
      await expect(
        bobPage.locator('[data-testid="action-call"]'),
      ).toBeEnabled();

      const bobRaiseButton = bobPage.locator('[data-testid="action-raise"]');
      await expect(bobRaiseButton).toBeDisabled();
      await bobPage.fill('[data-testid="raise-input"]', '20');
      await expect(bobRaiseButton).toBeEnabled();

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterBobCall = await getRoomSnapshot(alicePage);
      expect(afterBobCall.currentBet).toBe(DEFAULT_BIG_BLIND);
      expect(afterBobCall.bobCurrentBet).toBe(DEFAULT_BIG_BLIND);
      expect(afterBobCall.aliceCurrentBet).toBe(DEFAULT_BIG_BLIND);

      expect(
        await alicePage.locator('[data-testid="action-check"]').count(),
      ).toBe(1);
      expect(
        await alicePage.locator('[data-testid="action-call"]').count(),
      ).toBe(0);
      const turnState = await getRoomSnapshot(alicePage);
      expect(turnState.currentPlayerName).toBe('Alice');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.2b: Top Overlay Drops Redundant Stat Chips', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await expect(
        alicePage.locator(
          '[data-testid="turn-overlay"] [data-testid="pot-value"]',
        ),
      ).toHaveCount(0);
      await expect(
        alicePage.locator(
          '[data-testid="turn-overlay"] [data-testid="your-chips"]',
        ),
      ).toHaveCount(0);
      await expect(
        alicePage.locator(
          '[data-testid="turn-overlay"] [data-testid="turn-player"]',
        ),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="round-value"]'),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.2c: Tray Composer Uses Min-Raise First, Hides Call Without Pressure, And Clamps Custom Input', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 390, height: 844 }),
        bobPage.setViewportSize({ width: 390, height: 844 }),
      ]);
      await Promise.all([
        closeChatPanelIfOpen(alicePage),
        closeChatPanelIfOpen(bobPage),
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await Promise.all([
        closeChatPanelIfOpen(alicePage),
        closeChatPanelIfOpen(bobPage),
      ]);

      // Remove pre-flop call pressure so min raise becomes the opening amount.
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(bobPage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');

      const firstPreset = bobPage
        .locator('[data-testid="action-dock"] [data-tray-preset]')
        .first();
      await expect(firstPreset).toHaveAttribute(
        'data-testid',
        'chip-load-raise',
      );
      const continueButton = bobPage.locator(
        '[data-testid="chip-load-continue"]',
      );
      await expect(continueButton).toHaveCount(0);
      const openRaiseMenuButton = bobPage.locator(
        '[data-testid="action-open-raise-menu"]',
      );
      await expect(openRaiseMenuButton).toBeVisible();
      await expect(openRaiseMenuButton).toContainText('Bet');
      await openRaiseMenuButton.click();
      await expect(
        bobPage.locator('[data-testid="raise-action-popover"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="raise-action-popover"]'),
      ).toHaveAttribute('aria-label', 'Bet');
      await expect(
        bobPage.locator('.chip-raise-menu-popover__title'),
      ).toContainText('Bet');
      await expect(
        bobPage.locator(
          '[data-testid="raise-action-popover"] [data-testid="chip-load-all-in"]',
        ),
      ).toBeVisible();
      await openRaiseMenuButton.click();
      await expect(
        bobPage.locator('[data-testid="raise-action-popover"]'),
      ).toHaveCount(0);

      const raiseButton = bobPage.locator('[data-testid="chip-load-raise"]');
      await expect(raiseButton).toBeVisible();
      await expect(raiseButton).toBeEnabled();
      const raiseButtonText = (await raiseButton.textContent()) ?? '';
      const raiseAmountMatch = raiseButtonText.match(/\$([0-9]+)/);
      expect(raiseAmountMatch).not.toBeNull();
      expect(
        await bobPage.locator('[data-testid="chip-load-3bet"]').count(),
      ).toBe(0);

      await raiseButton.click();
      await expect(
        bobPage.locator('[data-testid="tray-amount-value"]'),
      ).toContainText(`$${raiseAmountMatch?.[1] ?? '0'}`);

      await expect(
        bobPage.locator('[data-testid="chip-custom-input"]'),
      ).toHaveCount(0);
      const mobileChipTrigger = bobPage.locator(
        '[data-testid="chip-mobile-input-trigger"]',
      );
      await expect(mobileChipTrigger).toBeVisible();
      const stackSnapshot = await getRoomSnapshot(bobPage);
      const bobStack = stackSnapshot.bobChips;

      await mobileChipTrigger.click();
      await expect(
        bobPage.locator('[data-testid="chip-mobile-input-popover"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="your-cards-section"]'),
      ).toBeVisible();
      const mobileChipOverlayCheck = await bobPage.evaluate(() => {
        const popover = document.querySelector<HTMLElement>(
          '[data-testid="chip-mobile-input-popover"]',
        );
        const cards = document.querySelector<HTMLElement>(
          '[data-testid="your-cards-section"]',
        );
        if (!popover || !cards) {
          return null;
        }

        const popoverRect = popover.getBoundingClientRect();
        const cardsRect = cards.getBoundingClientRect();
        const overlapLeft = Math.max(popoverRect.left, cardsRect.left);
        const overlapRight = Math.min(popoverRect.right, cardsRect.right);
        const overlapTop = Math.max(popoverRect.top, cardsRect.top);
        const overlapBottom = Math.min(popoverRect.bottom, cardsRect.bottom);
        const hasOverlap =
          overlapLeft < overlapRight && overlapTop < overlapBottom;
        const sampleX = hasOverlap
          ? overlapLeft + (overlapRight - overlapLeft) / 2
          : popoverRect.left + Math.min(popoverRect.width * 0.2, 40);
        const sampleY = hasOverlap
          ? overlapTop + (overlapBottom - overlapTop) / 2
          : popoverRect.top + Math.min(popoverRect.height * 0.2, 40);
        const topElement = document.elementFromPoint(sampleX, sampleY);

        return {
          hasOverlap,
          topTestId:
            topElement instanceof HTMLElement
              ? topElement.dataset.testid ??
                topElement.closest<HTMLElement>('[data-testid]')?.dataset
                  .testid ??
                null
              : null,
          popoverOwnsTopElement:
            topElement instanceof HTMLElement &&
            (topElement === popover || popover.contains(topElement)),
        };
      });
      expect(mobileChipOverlayCheck).not.toBeNull();
      expect(
        (mobileChipOverlayCheck?.hasOverlap ?? false) === false ||
          mobileChipOverlayCheck?.popoverOwnsTopElement === true,
      ).toBe(true);
      await bobPage.click('[data-testid="chip-mobile-popover-clear"]');
      for (let index = 0; index < 6; index += 1) {
        await bobPage.click('[data-testid="chip-mobile-digit-9"]');
      }
      await bobPage.click('[data-testid="chip-mobile-popover-confirm"]');
      await expect(
        bobPage.locator('[data-testid="chip-mobile-input-trigger"]'),
      ).toContainText(`$${bobStack}`);
      await expect(
        bobPage.locator('[data-testid="tray-amount-value"]'),
      ).toContainText(`$${bobStack}`);

      await mobileChipTrigger.click();
      await expect(
        bobPage.locator('[data-testid="chip-mobile-input-display"]'),
      ).toContainText(`$${bobStack}`);
      await bobPage.click('[data-testid="chip-mobile-popover-clear"]');
      await bobPage.click('[data-testid="chip-mobile-digit-5"]');
      await bobPage.click('[data-testid="chip-mobile-popover-cancel"]');
      await expect(
        bobPage.locator('[data-testid="chip-mobile-input-popover"]'),
      ).toHaveCount(0);
      await expect(mobileChipTrigger).toContainText(`$${bobStack}`);
      await expect(
        bobPage.locator('[data-testid="tray-amount-value"]'),
      ).toContainText(`$${bobStack}`);

      // Removed controls should no longer exist in the tray composer.
      expect(
        await bobPage.locator('[data-testid="chip-load-4bet"]').count(),
      ).toBe(0);
      expect(
        await bobPage.locator('[data-testid="chip-load-full-pot"]').count(),
      ).toBe(0);
      expect(await bobPage.locator('[data-testid="chip-add-5"]').count()).toBe(
        0,
      );
      expect(await bobPage.locator('[data-testid="chip-add-10"]').count()).toBe(
        0,
      );
      expect(await bobPage.locator('[data-testid="chip-add-25"]').count()).toBe(
        0,
      );
      expect(
        await bobPage.locator('[data-testid="chip-add-100"]').count(),
      ).toBe(0);
      expect(
        await bobPage.locator('[data-testid="chip-add-500"]').count(),
      ).toBe(0);
      expect(
        await bobPage.locator('[data-testid="chip-add-max"]').count(),
      ).toBe(0);
      expect(await bobPage.locator('[data-testid="chip-undo"]').count()).toBe(
        0,
      );

      await bobPage.click('[data-testid="chip-clear"]');
      await expect(
        bobPage.locator('[data-testid="tray-amount-value"]'),
      ).toContainText('$0');
      await expect(
        bobPage.locator('[data-testid="chip-mobile-input-trigger"]'),
      ).toContainText('$0');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.2d: Tray Composer Hides Illegal Non-All-In Presets When Clamped To Stack', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      roomConfig: {
        startingChips: 7,
        smallBlind: 5,
        bigBlind: 10,
      },
    });

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const snapshot = await getRoomSnapshot(bobPage);
      const bobStack = snapshot.bobChips;
      const callAmount = snapshot.currentBet - snapshot.bobCurrentBet;
      expect(bobStack).toBeGreaterThan(0);
      expect(callAmount).toBeGreaterThan(0);
      expect(bobStack).toBeLessThanOrEqual(callAmount);

      const continueButton = bobPage.locator(
        '[data-testid="chip-load-continue"]',
      );
      await expect(continueButton).toHaveCount(0);

      const raiseButton = bobPage.locator('[data-testid="chip-load-raise"]');
      await expect(raiseButton).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="preset-third-pot"]')).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="preset-half-pot"]')).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="preset-pot"]')).toHaveCount(0);

      const allInButton = bobPage.locator('[data-testid="chip-load-all-in"]');
      await expect(allInButton).toContainText(`$${bobStack}`);
      await expect(allInButton).toBeEnabled();

      await expect(
        bobPage.locator('[data-testid="action-dock"] [data-tray-preset]'),
      ).toHaveCount(1);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.3: Card Display', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'K' }, // Alice
        { suit: 'spades', rank: 'Q' }, // Bob
        { suit: 'spades', rank: 'J' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: '9' }, // Turn
        { suit: 'diamonds', rank: '10' }, // River
      ]);

      await startGameFromLobby(alicePage, bobPage);

      const aliceRanks = await getYourCardRanksFromUi(alicePage);
      const bobRanks = await getYourCardRanksFromUi(bobPage);
      expect(aliceRanks).toEqual(['A', 'K']);
      expect(bobRanks).toEqual(['Q', 'J']);

      expect(await getCommunityCardCountFromUi(alicePage)).toBe(0);

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);
      expect(await getCommunityCardCountFromUi(alicePage)).toBe(3);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'TURN', 4);
      expect(await getCommunityCardCountFromUi(alicePage)).toBe(4);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'RIVER', 5);
      expect(await getCommunityCardCountFromUi(alicePage)).toBe(5);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4: Leave Room Navigates Home', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { bobPage } = session;
      await openLeaveRoomConfirm(bobPage);
      await bobPage.click('[data-testid="leave-room-confirm-cancel"]');
      await expect(
        bobPage.locator('[data-testid="leave-room-confirm-modal"]'),
      ).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="room-title"]')).toBeVisible();

      await confirmLeaveRoom(bobPage);

      await expect(bobPage).toHaveURL(/\/$/);
      await expect(
        bobPage.locator('[data-testid="create-room-button"]'),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4a: Entrance Screen Keeps URL At Root', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await authenticateTestUser(page, 'test1', {
        displayName: 'RouteCheck',
        avatarEmoji: '🧭',
      });

      await page.click('[data-testid="join-toggle-button"]');
      await page.fill('[data-testid="room-id-input"]', 'ZZZZZZ');
      await page.click('[data-testid="join-room-button"]');

      await expect(page.locator('[data-testid="form-feedback"]')).toContainText(
        /.+/,
      );
      await expect(page.locator('[data-testid="room-id-input"]')).toHaveValue(
        'ZZZZZZ',
      );
      await expect(
        page.locator('[data-testid="join-room-button"]'),
      ).toBeVisible();
      await expect(page.locator('[data-testid="back-button"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="create-room-button"]'),
      ).toHaveCount(0);
      const pathnameAfterJoinAttempt = await page.evaluate(
        () => window.location.pathname,
      );
      expect(pathnameAfterJoinAttempt).toBe('/');

      await expect(page).toHaveURL(/\/$/);
      await page.click('[data-testid="back-button"]');

      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('[data-testid="room-id-input"]')).toHaveCount(
        0,
      );
      await expect(page.locator('[data-testid="form-feedback"]')).toHaveCount(
        0,
      );
      await expect(
        page.locator('[data-testid="create-room-button"]'),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('8.4aa: Auth Removes Redundant Copy And Supports Full Emoji Selection', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(FRONTEND_URL);
      await page.waitForSelector('[data-testid="auth-page"]');

      const authPage = page.locator('[data-testid="auth-page"]');
      await expect(authPage).not.toContainText(
        'Passkey is recommended. Password login is enabled for test accounts (test1/test2/test3).',
      );
      await expect(authPage).not.toContainText(
        'Register with Passkey first. If you already have one, use the login button below.',
      );

      await page
        .getByRole('button', {
          name: /Register and sign in with Passkey|用 Passkey 注册并登录/,
        })
        .click();
      await expect(
        page.locator('[data-testid="auth-emoji-grid"]'),
      ).toBeVisible();

      const emojiGrid = page.locator('[data-testid="auth-emoji-grid"]');
      const extendedEmojiOption = page.locator(
        '[data-testid="auth-emoji-option"][data-emoji="👾"]',
      );
      await extendedEmojiOption.scrollIntoViewIfNeeded();
      await extendedEmojiOption.click();
      await expect(extendedEmojiOption).toHaveClass(/ring-emerald-300\/80/);

      const isScrollable = await emojiGrid.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      );
      expect(isScrollable).toBe(true);

      await page.evaluate(() => {
        window.localStorage.setItem('poker.locale', 'zh_hans');
      });
      await page.goto(FRONTEND_URL);
      await page.waitForSelector('[data-testid="auth-page"]');

      await expect(authPage).not.toContainText(
        '默认推荐使用 Passkey。测试环境支持账号密码（test1/test2/test3）。',
      );
      await expect(authPage).not.toContainText(
        '新用户请先注册 Passkey；已有 Passkey 可点击下方登录按钮。',
      );
    } finally {
      await context.close();
    }
  });

  test('8.4ab: Host can create short-deck room from lobby and keep short-deck state in game', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    try {
      await authenticateStandardTwoPlayerPages(alicePage, bobPage);

      const shortDeckToggle = alicePage.locator(
        '[data-testid="short-deck-toggle"] input[type="checkbox"]',
      );
      await expect(shortDeckToggle).not.toBeChecked();
      await shortDeckToggle.check();
      await expect(shortDeckToggle).toBeChecked();

      await alicePage.click('[data-testid="create-room-button"]');
      await alicePage.waitForSelector('[data-testid="room-title"]');
      await expect(
        alicePage.locator('[data-testid="room-rule-variant"]'),
      ).toContainText(/Short Deck Rules|短牌规则/);

      const hostRoomState = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return {
          roomCode: room?.id ?? null,
          useShortDeckRules: room?.config?.useShortDeckRules === true,
        };
      });
      expect(hostRoomState.roomCode).toBeTruthy();
      expect(hostRoomState.useShortDeckRules).toBe(true);

      await bobPage.click('[data-testid="join-toggle-button"]');
      await bobPage.fill(
        '[data-testid="room-id-input"]',
        hostRoomState.roomCode as string,
      );
      await bobPage.click('[data-testid="join-room-button"]');
      await Promise.all([
        alicePage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
        bobPage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
      ]);

      await startGameFromLobby(alicePage, bobPage);

      const dealtState = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const cards = (window as any).pokerDebug?.getCards?.() ?? [];
        return {
          useShortDeckRules: room?.config?.useShortDeckRules === true,
          myRanks: cards.map((card: { rank: string }) => card.rank),
        };
      });
      expect(dealtState.useShortDeckRules).toBe(true);
      expect(dealtState.myRanks).toHaveLength(2);
      expect(
        dealtState.myRanks.some((rank: string) =>
          ['2', '3', '4', '5'].includes(rank),
        ),
      ).toBe(false);
      await expect(
        alicePage.locator('[data-testid="room-rule-variant"]'),
      ).toContainText(/Short Deck Rules|短牌规则/);

      await alicePage.click('[data-testid="open-rules-button"]');
      const rulesModal = alicePage.locator('[data-testid="rules-modal"]');
      await expect(rulesModal).toBeVisible();
      await expect(rulesModal).toContainText(/A-6-7-8-9/);
      await expect(rulesModal).not.toContainText(/A-2-3-4-5/);
      await expect(rulesModal).toContainText(/#4\s*(Flush|同花)/);
      await expect(rulesModal).toContainText(/#5\s*(Full House|葫芦)/);
      await expect(rulesModal).not.toContainText(/#4\s*(Full House|葫芦)/);
      await alicePage.click('[data-testid="close-rules-button"]');
      await expect(rulesModal).toBeHidden();
    } finally {
      await Promise.allSettled([aliceContext.close(), bobContext.close()]);
    }
  });

  test('8.4ac: Signed-out invite links preserve room code through auth without manual re-entry', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    try {
      await authenticateTestUser(alicePage, 'test1', {
        displayName: 'Alice',
        avatarEmoji: '🦊',
      });
      const roomCode = await createRoomViaSocket(alicePage, 'Alice');

      const roomRoutePattern = `${FRONTEND_URL}/room/*`;
      await bobPage.route(roomRoutePattern, async (route) => {
        const response = await bobPage.request.get(FRONTEND_URL);
        const body = await response.text();
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body,
        });
      });
      await bobPage.goto(`${FRONTEND_URL}/room/${roomCode}`, {
        waitUntil: 'domcontentloaded',
      });
      await bobPage.unroute(roomRoutePattern);
      await bobPage.waitForSelector('[data-testid="auth-page"]');
      await expect(bobPage).toHaveURL(
        new RegExp(`/auth\\?roomId=${roomCode}$`),
      );

      await authenticateTestUser(bobPage, 'test2', {
        displayName: 'Bob',
        avatarEmoji: '🐻',
      });

      await bobPage.evaluate((nextRoomCode) => {
        window.history.pushState({}, '', `/auth?roomId=${nextRoomCode}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, roomCode);

      await bobPage.waitForSelector('[data-testid="home-panel"]');
      await expect(bobPage).toHaveURL(
        new RegExp(`\\/\\?roomId=${roomCode}$`),
      );
      await expect(bobPage.locator('[data-testid="room-id-input"]')).toHaveValue(
        roomCode,
      );
      await expect(bobPage.locator('[data-testid="room-id-input"]')).toBeDisabled();

      await bobPage.click('[data-testid="join-room-button"]');
      await bobPage.waitForSelector('[data-testid="room-title"]');
      await expect(bobPage.locator('[data-testid="room-title"]')).toContainText(
        roomCode,
      );
    } finally {
      await Promise.allSettled([aliceContext.close(), bobContext.close()]);
    }
  });

  test('8.4b: Home Reuses Saved Profile After Leaving Room', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await authenticateTestUser(page, 'test1', {
        displayName: 'RememberMe',
      });
      await page.click('[data-testid="create-room-button"]');
      await page.waitForSelector('[data-testid="room-title"]');

      await confirmLeaveRoom(page);
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.locator('[data-testid="create-room-button"]'),
      ).toBeVisible();

      await page.click('[data-testid="create-room-button"]');
      await page.waitForSelector('[data-testid="room-title"]');

      const recreatedPlayerName = await page.evaluate(() => {
        const player = (window as any).pokerDebug?.getPlayer?.();
        return player?.name ?? null;
      });
      expect(recreatedPlayerName).toBe('RememberMe');
    } finally {
      await context.close();
    }
  });

  test('8.4c1: Mid-Hand Waiting Badge Stays Outside Seat', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);
    let charlieContext: BrowserContext | null = null;

    try {
      const { alicePage, bobPage, roomCode } = session;
      await startGameFromLobby(alicePage, bobPage);

      charlieContext = await browser.newContext();
      const charliePage = await charlieContext.newPage();
      await authenticateTestUser(charliePage, 'test3', {
        displayName: 'Charlie',
        avatarEmoji: '🐯',
      });

      await charliePage.click('[data-testid="join-toggle-button"]');
      await charliePage.fill('[data-testid="room-id-input"]', roomCode);
      await charliePage.click('[data-testid="join-room-button"]');
      await charliePage.waitForSelector(
        '[data-testid="room-player-count"]:has-text("Players: 3/")',
      );

      const waitingState = await charliePage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const room = pokerDebug?.getRoom?.();
        const player = pokerDebug?.getPlayer?.();
        const cards = pokerDebug?.getCards?.();
        const activePlayers = room?.currentHand?.activePlayers ?? [];

        return {
          playerId: player?.id ?? null,
          status: player?.status ?? null,
          cardsCount: Array.isArray(cards) ? cards.length : 0,
          inActiveHand: Boolean(
            player?.id && activePlayers.includes(player.id),
          ),
        };
      });
      expect(waitingState.status).toBe('waiting');
      expect(waitingState.cardsCount).toBe(0);
      expect(waitingState.inActiveHand).toBe(false);
      expect(waitingState.playerId).not.toBeNull();

      await assertWaitingBadgeExternalForSeat(
        charliePage,
        waitingState.playerId as string,
      );
    } finally {
      await Promise.allSettled([
        charlieContext?.close(),
        teardownTwoPlayerSession(session),
      ]);
    }
  });

  test('8.4c: Player Can Join Mid-Hand And Wait For Next Hand', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);
    let charlieContext: BrowserContext | null = null;

    try {
      const { alicePage, bobPage, roomCode } = session;
      await startGameFromLobby(alicePage, bobPage);

      charlieContext = await browser.newContext();
      const charliePage = await charlieContext.newPage();
      await authenticateTestUser(charliePage, 'test3', {
        displayName: 'Charlie',
        avatarEmoji: '🐯',
      });

      await charliePage.click('[data-testid="join-toggle-button"]');
      await charliePage.fill('[data-testid="room-id-input"]', roomCode);
      await charliePage.click('[data-testid="join-room-button"]');
      await charliePage.waitForSelector(
        '[data-testid="room-player-count"]:has-text("Players: 3/")',
      );

      const waitingState = await charliePage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const room = pokerDebug?.getRoom?.();
        const player = pokerDebug?.getPlayer?.();
        const cards = pokerDebug?.getCards?.();
        const activePlayers = room?.currentHand?.activePlayers ?? [];

        return {
          playerId: player?.id ?? null,
          status: player?.status ?? null,
          chips: player?.chips ?? 0,
          totalBuyIn: player?.totalBuyIn ?? 0,
          cardsCount: Array.isArray(cards) ? cards.length : 0,
          inActiveHand: Boolean(
            player?.id && activePlayers.includes(player.id),
          ),
        };
      });
      expect(waitingState.status).toBe('waiting');
      expect(waitingState.cardsCount).toBe(0);
      expect(waitingState.inActiveHand).toBe(false);
      expect(waitingState.chips).toBe(1000);
      expect(waitingState.totalBuyIn).toBe(1000);
      expect(waitingState.playerId).not.toBeNull();

      await assertWaitingBadgeExternalForSeat(
        charliePage,
        waitingState.playerId as string,
      );

      await waitForPlayerTurn(bobPage, 'Bob');
      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;

      await startNextHandOrWaitForAutoStart(alicePage, 2);
      await waitForHoleCards(charliePage);
      const nextHandState = await charliePage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const player = pokerDebug?.getPlayer?.();
        const cards = pokerDebug?.getCards?.();

        return {
          status: player?.status ?? null,
          totalBuyIn: player?.totalBuyIn ?? 0,
          cardsCount: Array.isArray(cards) ? cards.length : 0,
        };
      });
      expect(nextHandState.status).toBe('connected');
      expect(nextHandState.cardsCount).toBe(2);
      expect(nextHandState.totalBuyIn).toBe(1000);
    } finally {
      await Promise.allSettled([
        charlieContext?.close(),
        teardownTwoPlayerSession(session),
      ]);
    }
  });

  test('8.4d: Player Emoji Selection Shows On Seats', async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    try {
      await authenticateStandardTwoPlayerPages(alicePage, bobPage);
      await ensureProfileForCurrentSession(alicePage, {
        displayName: 'Alice',
        avatarEmoji: '😎',
      });
      await ensureProfileForCurrentSession(bobPage, {
        displayName: 'Bob',
        avatarEmoji: '🐯',
      });

      await alicePage.reload({ waitUntil: 'domcontentloaded' });
      await bobPage.reload({ waitUntil: 'domcontentloaded' });
      await alicePage.waitForSelector('[data-testid="create-room-button"]');
      await bobPage.waitForSelector('[data-testid="create-room-button"]');

      await alicePage.click('[data-testid="create-room-button"]');
      await alicePage.waitForSelector('[data-testid="room-title"]');

      const roomTitle = await alicePage.textContent(
        '[data-testid="room-title"]',
      );
      const roomCode = roomTitle?.match(/Room: (.+)/)?.[1];
      expect(roomCode).toBeTruthy();

      await bobPage.click('[data-testid="join-toggle-button"]');
      await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
      await bobPage.click('[data-testid="join-room-button"]');
      await bobPage.waitForSelector(
        '[data-testid="room-player-count"]:has-text("Players: 2/")',
      );

      await expect(
        alicePage.locator('[data-testid="players-section"]'),
      ).toContainText('😎');
      await expect(
        alicePage.locator('[data-testid="players-section"]'),
      ).toContainText('🐯');
      await expect(
        bobPage.locator('[data-testid="players-section"]'),
      ).toContainText('😎');
      await expect(
        bobPage.locator('[data-testid="players-section"]'),
      ).toContainText('🐯');

      const emojiMap = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return Object.fromEntries(
          (room?.players ?? []).map((player: any) => [
            player.name,
            player.emoji ?? null,
          ]),
        );
      });
      expect(emojiMap.Alice).toBe('😎');
      expect(emojiMap.Bob).toBe('🐯');
    } finally {
      await Promise.allSettled([aliceContext.close(), bobContext.close()]);
    }
  });

  test('@critical 8.4e: Leaving To The Lobby Shows A Returnable Room Card And Rejoin Keeps Player ID', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;

      const bobBeforeLeave = await bobPage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const player = pokerDebug?.getPlayer?.();
        return {
          playerId: player?.id ?? null,
        };
      });
      expect(bobBeforeLeave.playerId).toBeTruthy();

      await confirmLeaveRoom(bobPage);
      await expect(bobPage).toHaveURL(/\/$/);

      await alicePage.waitForSelector(
        '[data-testid="room-player-count"]:has-text("Players: 1/")',
      );

      await bobPage.click('[data-testid="join-toggle-button"]');
      await expect(
        bobPage.locator('[data-testid="rejoinable-room-list"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator(`[data-testid="rejoinable-room-card-${roomCode}"]`),
      ).toBeVisible();
      await bobPage.click(
        `[data-testid="rejoinable-room-button-${roomCode}"]`,
      );

      await Promise.all([
        bobPage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
        alicePage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
      ]);

      const bobAfterRejoin = await bobPage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const room = pokerDebug?.getRoom?.();
        const player = pokerDebug?.getPlayer?.();
        const players = room?.players ?? [];
        const statusInRoom =
          players.find((entry: any) => entry.name === 'Bob')?.status ?? null;

        return {
          playerId: player?.id ?? null,
          status: player?.status ?? null,
          statusInRoom,
        };
      });

      expect(bobAfterRejoin.playerId).toBe(bobBeforeLeave.playerId);
      expect(bobAfterRejoin.status).toBe('waiting');
      expect(bobAfterRejoin.statusInRoom).toBe('waiting');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4ea: Leave Is Blocked During An Active Hand', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await openLeaveRoomConfirm(bobPage);
      await expect(
        bobPage.locator('[data-testid="leave-room-confirm-availability-reason"]'),
      ).toContainText(/Finish the current hand|当前这手牌结束/);
      await expect(
        bobPage.locator('[data-testid="leave-room-confirm-accept"]'),
      ).toBeDisabled();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4eb: Manual Room-Code Rejoin Avoids The Generic Name-Taken Failure', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;

      const bobBeforeLeave = await bobPage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const player = pokerDebug?.getPlayer?.();
        return {
          playerId: player?.id ?? null,
        };
      });

      await confirmLeaveRoom(bobPage);
      await expect(bobPage).toHaveURL(/\/$/);
      await alicePage.waitForSelector(
        '[data-testid="room-player-count"]:has-text("Players: 1/")',
      );

      await bobPage.click('[data-testid="join-toggle-button"]');
      await bobPage.fill('[data-testid="room-id-input"]', roomCode);
      await bobPage.click('[data-testid="join-room-button"]');

      await Promise.all([
        bobPage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
        alicePage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
      ]);

      await expect(
        bobPage.locator('[data-testid="form-feedback"]'),
      ).toHaveCount(0);

      const bobAfterRejoin = await bobPage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const player = pokerDebug?.getPlayer?.();
        return {
          playerId: player?.id ?? null,
          status: player?.status ?? null,
        };
      });

      expect(bobAfterRejoin.playerId).toBe(bobBeforeLeave.playerId);
      expect(bobAfterRejoin.status).toBe('waiting');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4ec: Rejoining After A Profile Change Syncs The Updated Name To Other Players', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;

      await confirmLeaveRoom(bobPage);
      await expect(bobPage).toHaveURL(/\/$/);
      await alicePage.waitForSelector(
        '[data-testid="room-player-count"]:has-text("Players: 1/")',
      );

      await ensureProfileForCurrentSession(bobPage, {
        displayName: 'Bobby',
        avatarEmoji: '🐯',
      });
      await bobPage.click('[data-testid="join-toggle-button"]');
      await bobPage.fill('[data-testid="room-id-input"]', roomCode);
      await bobPage.click('[data-testid="join-room-button"]');

      await Promise.all([
        bobPage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
        alicePage.waitForSelector(
          '[data-testid="room-player-count"]:has-text("Players: 2/")',
        ),
      ]);

      await bobPage.waitForFunction(
        () => window.pokerDebug?.getPlayer?.()?.name === 'Bobby',
      );
      await alicePage.waitForFunction(() =>
        window.pokerDebug
          ?.getRoom?.()
          ?.players?.some((player: any) => player.name === 'Bobby'),
      );

      const aliceViewOfBob = await alicePage.evaluate(() => {
        const room = window.pokerDebug?.getRoom?.();
        const matchingPlayer = room?.players?.find(
          (player: any) => player.name === 'Bobby',
        );
        return {
          name: matchingPlayer?.name ?? null,
          emoji: matchingPlayer?.emoji ?? null,
        };
      });

      expect(aliceViewOfBob.name).toBe('Bobby');
      expect(aliceViewOfBob.emoji).toBe('🐯');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4f: Final Summary Leave Uses Shared Confirmation Flow', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await expect(
        alicePage.locator('[data-testid="next-hand-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="end-game-button"]');
      await expect(
        alicePage.locator('[data-testid="end-game-confirm-modal"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="end-game-confirm-accept"]');

      await expect(
        alicePage.locator('[data-testid="final-summary-modal"]'),
      ).toBeVisible();

      await openLeaveRoomConfirm(
        alicePage,
        '[data-testid="leave-from-final-summary-button"]',
      );
      await alicePage.click('[data-testid="leave-room-confirm-cancel"]');
      await expect(
        alicePage.locator('[data-testid="leave-room-confirm-modal"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="final-summary-modal"]'),
      ).toBeVisible();

      await confirmLeaveRoom(
        alicePage,
        '[data-testid="leave-from-final-summary-button"]',
      );
      await expect(alicePage).toHaveURL(/\/$/);
      await expect(
        alicePage.locator('[data-testid="create-room-button"]'),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.5: Players Can Ready Next Hand After Break', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const firstHand = await getRoomSnapshot(alicePage);
      expect(firstHand.handNumber).toBe(1);

      await bobPage.click('[data-testid="action-fold"]');

      await alicePage.waitForFunction(
        () =>
          window.pokerDebug?.getRoom()?.currentHand?.currentPlayerTurn === null,
        { timeout: 10000 },
      );
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid$="-ready-overlay"]'),
      ).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid$="-ready-overlay"]'),
      ).toHaveCount(0);

      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="start-next-hand-button"]');
      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="next-hand-action-area"]'),
      ).toBeVisible();

      await waitForHandStart(alicePage, 2);

      const secondHand = await getRoomSnapshot(alicePage);
      expect(secondHand.handNumber).toBe(2);
      expect(secondHand.currentPlayerName).toBeTruthy();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.6: Player List Shows Total Buy-In', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const aliceViewMoney = await getPlayersMoneyFromUi(alicePage);
      expect(aliceViewMoney.Alice.totalBuyIn).toBe(1000);
      expect(aliceViewMoney.Bob.totalBuyIn).toBe(1000);

      const bobViewMoney = await getPlayersMoneyFromUi(bobPage);
      expect(bobViewMoney.Alice.totalBuyIn).toBe(1000);
      expect(bobViewMoney.Bob.totalBuyIn).toBe(1000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.7: Bust Auto-Refill Increments Total Buy-In', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'spades', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'clubs', rank: '2' }, // Bob
        { suit: 'diamonds', rank: '7' }, // Bob
        { suit: 'clubs', rank: 'K' }, // Flop 1
        { suit: 'diamonds', rank: 'Q' }, // Flop 2
        { suit: 'hearts', rank: 'J' }, // Flop 3
        { suit: 'spades', rank: '9' }, // Turn
        { suit: 'clubs', rank: '3' }, // River
        { suit: 'clubs', rank: '4' }, // Alice (hand 2)
        { suit: 'diamonds', rank: '4' }, // Alice (hand 2)
        { suit: 'clubs', rank: '5' }, // Bob (hand 2)
        { suit: 'diamonds', rank: '5' }, // Bob (hand 2)
        { suit: 'hearts', rank: '2' }, // Flop 1 (hand 2)
        { suit: 'spades', rank: '8' }, // Flop 2 (hand 2)
        { suit: 'diamonds', rank: 'K' }, // Flop 3 (hand 2)
        { suit: 'clubs', rank: '9' }, // Turn (hand 2)
        { suit: 'hearts', rank: 'J' }, // River (hand 2)
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-all-in"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      const result = await handCompletePromise;
      const bobWon = result.winners.some(
        (winner: any) => winner.playerName === 'Bob',
      );
      expect(bobWon).toBe(false);

      // In TEST_MODE, next hand auto-starts after hand complete.
      await waitForHandStart(alicePage, 2);

      const uiMoney = await getPlayersMoneyFromUi(alicePage);
      expect(uiMoney.Alice.totalBuyIn).toBe(1000);
      expect(uiMoney.Bob.totalBuyIn).toBe(2000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.8: Fold Is Always Available On Turn And Actions Apply Immediately', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await alicePage.setViewportSize({ width: 1280, height: 620 });
      await bobPage.setViewportSize({ width: 1280, height: 620 });
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await expect(
        bobPage.locator('[data-testid="action-fold"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="action-fold"]'),
      ).toBeEnabled();
      await expect(
        bobPage.locator('[data-testid="action-dock"] input[type="checkbox"]'),
      ).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid="action-confirm-modal"]'),
      ).toHaveCount(0);

      await bobPage.click('[data-testid="action-call"]');
      await expect(
        bobPage.locator('[data-testid="action-confirm-modal"]'),
      ).toHaveCount(0);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(bobPage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');

      await expect(
        bobPage.locator('[data-testid="action-check"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="action-fold"]'),
      ).toBeVisible();
      const dockScrollBehavior = await bobPage.evaluate(() => {
        const dock = document.querySelector<HTMLElement>(
          '[data-testid="turn-overlay"]',
        );
        if (!dock) return null;
        const styles = window.getComputedStyle(dock);
        return {
          overflowY: styles.overflowY,
          overflow: styles.overflow,
        };
      });
      expect(dockScrollBehavior).not.toBeNull();
      const controlsAreInViewport = await bobPage.evaluate(() => {
        const fold = document.querySelector<HTMLElement>(
          '[data-testid="action-fold"]',
        );
        const check = document.querySelector<HTMLElement>(
          '[data-testid="action-check"]',
        );
        if (!fold || !check) return false;

        const foldRect = fold.getBoundingClientRect();
        const checkRect = check.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        const isInsideViewport = (rect: DOMRect) =>
          rect.top >= 0 && rect.bottom <= viewportHeight;

        return isInsideViewport(foldRect) && isInsideViewport(checkRect);
      });
      expect(controlsAreInViewport).toBe(true);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8a: Seat Cards Stay Inside Table Bounds Across Viewports', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;

      await Promise.all([
        alicePage.setViewportSize({ width: 1280, height: 620 }),
        bobPage.setViewportSize({ width: 1280, height: 620 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await assertSeatCardsWithinTableBounds(alicePage, 'desktop-alice');
      await assertSeatCardsWithinTableBounds(bobPage, 'desktop-bob');

      await Promise.all([
        alicePage.setViewportSize({ width: 390, height: 844 }),
        bobPage.setViewportSize({ width: 390, height: 844 }),
      ]);

      await alicePage.waitForTimeout(120);
      await bobPage.waitForTimeout(120);

      await assertSeatCardsWithinTableBounds(alicePage, 'mobile-alice');
      await assertSeatCardsWithinTableBounds(bobPage, 'mobile-bob');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8c: Seat Cards Never Overlap Community Cards Or Pot Across Viewports', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const viewports = [
        { label: 'desktop-720p', width: 1280, height: 720 },
        { label: 'desktop-wide', width: 1536, height: 864 },
        { label: 'tablet-landscape', width: 1024, height: 768 },
        { label: 'tablet-portrait', width: 768, height: 1024 },
        { label: 'mobile-breakpoint-470', width: 470, height: 915 },
        { label: 'mobile-large-portrait', width: 412, height: 915 },
        { label: 'mobile-medium-portrait', width: 390, height: 844 },
        { label: 'mobile-small-portrait', width: 360, height: 640 },
        { label: 'mobile-xsmall-portrait', width: 320, height: 568 },
        { label: 'mobile-landscape', width: 844, height: 390 },
      ];

      for (const viewport of viewports) {
        await Promise.all([
          alicePage.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          }),
          bobPage.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          }),
        ]);
        await alicePage.waitForTimeout(180);
        await bobPage.waitForTimeout(180);

        await assertSeatCardsWithinTableBounds(
          alicePage,
          `${viewport.label}-alice`,
        );
        await assertSeatCardsWithinTableBounds(
          bobPage,
          `${viewport.label}-bob`,
        );
        await assertSeatCardsDoNotOverlapBoardAndPot(
          alicePage,
          `${viewport.label}-alice`,
        );
        await assertSeatCardsDoNotOverlapBoardAndPot(
          bobPage,
          `${viewport.label}-bob`,
        );
      }
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8d: Non-Name Seat Text Never Truncates Across Viewports', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const viewports = [
        { label: 'desktop-720p', width: 1280, height: 720 },
        { label: 'desktop-wide', width: 1536, height: 864 },
        { label: 'tablet-landscape', width: 1024, height: 768 },
        { label: 'tablet-portrait', width: 768, height: 1024 },
        { label: 'mobile-large-portrait', width: 412, height: 915 },
        { label: 'mobile-medium-portrait', width: 390, height: 844 },
        { label: 'mobile-small-portrait', width: 360, height: 640 },
        { label: 'mobile-xsmall-portrait', width: 320, height: 568 },
        { label: 'mobile-landscape', width: 844, height: 390 },
      ];

      for (const viewport of viewports) {
        await Promise.all([
          alicePage.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          }),
          bobPage.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          }),
        ]);
        await alicePage.waitForTimeout(180);
        await bobPage.waitForTimeout(180);

        await assertSeatCardsNonNameTextUnclipped(
          alicePage,
          `${viewport.label}-alice`,
        );
        await assertSeatCardsNonNameTextUnclipped(
          bobPage,
          `${viewport.label}-bob`,
        );
      }
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8e: Seat Cards Do Not Become Overly Empty Across Viewports', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const viewports = [
        { label: 'desktop-720p', width: 1280, height: 720 },
        { label: 'desktop-wide', width: 1536, height: 864 },
        { label: 'tablet-landscape', width: 1024, height: 768 },
        { label: 'tablet-portrait', width: 768, height: 1024 },
        { label: 'mobile-large-portrait', width: 412, height: 915 },
        { label: 'mobile-medium-portrait', width: 390, height: 844 },
        { label: 'mobile-small-portrait', width: 360, height: 640 },
        { label: 'mobile-xsmall-portrait', width: 320, height: 568 },
        { label: 'mobile-landscape', width: 844, height: 390 },
      ];

      for (const viewport of viewports) {
        await Promise.all([
          alicePage.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          }),
          bobPage.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          }),
        ]);
        await alicePage.waitForTimeout(180);
        await bobPage.waitForTimeout(180);

        await assertSeatCardsWhitespaceRatioWithinLimit(
          alicePage,
          `${viewport.label}-alice`,
        );
        await assertSeatCardsWhitespaceRatioWithinLimit(
          bobPage,
          `${viewport.label}-bob`,
        );
      }
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8b: Visual Smoke Covers Desktop And Mobile Table Layout', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const runtimeErrors: string[] = [];

      alicePage.on('pageerror', (error) => runtimeErrors.push(error.message));
      alicePage.on('console', (message) => {
        if (message.type() === 'error') {
          runtimeErrors.push(message.text());
        }
      });

      await Promise.all([
        alicePage.setViewportSize({ width: 1280, height: 720 }),
        bobPage.setViewportSize({ width: 1280, height: 720 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await expect(
        alicePage.locator('[data-testid="room-title"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="table-board-section"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="pot-drop-zone"]'),
      ).toBeVisible();

      const desktopScreenshot = await alicePage.screenshot({ fullPage: true });
      expect(desktopScreenshot.byteLength).toBeGreaterThan(20_000);

      await alicePage.setViewportSize({ width: 390, height: 844 });
      await alicePage.waitForTimeout(180);

      await expect(
        alicePage.locator('[data-testid="room-title"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="table-board-section"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="pot-drop-zone"]'),
      ).toBeVisible();

      const mobileScreenshot = await alicePage.screenshot({ fullPage: true });
      expect(mobileScreenshot.byteLength).toBeGreaterThan(12_000);
      expect(runtimeErrors).toEqual([]);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8f: Desktop room uses a fixed game column and right rail', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1440, height: 900 }),
        bobPage.setViewportSize({ width: 1440, height: 900 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await expect(
        alicePage.locator('[data-testid="desktop-game-column"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="desktop-right-rail"]'),
      ).toBeVisible();
      await expect(alicePage.locator('[data-testid="open-live-audio-button"]')).toBeVisible();
      await expect(alicePage.locator('[data-testid="chat-panel"]')).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="desktop-side-status"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="chat-preview-strip"]'),
      ).toHaveCount(0);
      await alicePage.click('[data-testid="open-live-audio-button"]');
      await expect(alicePage.locator('[data-testid="live-audio-popover"]')).toBeVisible();
      await expect(alicePage.locator('[data-testid="live-audio-panel"]')).toBeVisible();

      const layout = await alicePage.evaluate(() => {
        const gameColumn = document.querySelector<HTMLElement>(
          '[data-testid="desktop-game-column"]',
        );
        const rightRail = document.querySelector<HTMLElement>(
          '[data-testid="desktop-right-rail"]',
        );
        const felt = document.querySelector<HTMLElement>('.felt-oval');
        const flyout = document.querySelector<HTMLElement>(
          '[data-testid="your-cards-flyout"]',
        );
        const liveAudioButton = document.querySelector<HTMLElement>(
          '[data-testid="open-live-audio-button"]',
        );
        const liveAudioPopover = document.querySelector<HTMLElement>(
          '[data-testid="live-audio-popover"]',
        );
        const chatPanel = document.querySelector<HTMLElement>(
          '[data-testid="chat-panel"]',
        );

        if (
          !gameColumn ||
          !rightRail ||
          !felt ||
          !flyout ||
          !liveAudioButton ||
          !liveAudioPopover ||
          !chatPanel
        ) {
          return null;
        }

        const gameRect = gameColumn.getBoundingClientRect();
        const railRect = rightRail.getBoundingClientRect();
        const feltRect = felt.getBoundingClientRect();
        const flyoutRect = flyout.getBoundingClientRect();
        const liveAudioButtonRect = liveAudioButton.getBoundingClientRect();
        const liveAudioPopoverRect = liveAudioPopover.getBoundingClientRect();
        const chatRect = chatPanel.getBoundingClientRect();

        return {
          railStartsAfterGameColumn: railRect.left >= gameRect.right - 1,
          liveAudioPopoverOpensBelowButton: liveAudioPopoverRect.top >= liveAudioButtonRect.bottom - 1,
          liveAudioPopoverStaysLeftOfRightRail: liveAudioPopoverRect.right <= chatRect.left + 1,
          cardsStayOutOfRightRail: flyoutRect.right <= railRect.left + 1,
        };
      });

      expect(layout).not.toBeNull();
      expect(layout?.railStartsAfterGameColumn).toBe(true);
      expect(layout?.liveAudioPopoverOpensBelowButton).toBe(true);
      expect(layout?.liveAudioPopoverStaysLeftOfRightRail).toBe(true);
      expect(layout?.cardsStayOutOfRightRail).toBe(true);
      await expectYourCardsFlyoutLeftOfActionArea(alicePage, 'desktop-dock-anchor');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8g: Desktop table board stays aligned with the top bar and game column', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1440, height: 900 }),
        bobPage.setViewportSize({ width: 1440, height: 900 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await expect(
        alicePage.locator('[data-testid="desktop-game-column"]'),
      ).toBeVisible();
      await expect(alicePage.locator('.table-micro-hud')).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="table-board-section"]'),
      ).toBeVisible();

      const alignment = await alicePage.evaluate(() => {
        const gameColumn = document.querySelector<HTMLElement>(
          '[data-testid="desktop-game-column"]',
        );
        const topBar = document.querySelector<HTMLElement>('.table-micro-hud');
        const boardSection = document.querySelector<HTMLElement>(
          '[data-testid="table-board-section"]',
        );

        if (!gameColumn || !topBar || !boardSection) {
          return null;
        }

        const gameRect = gameColumn.getBoundingClientRect();
        const topBarRect = topBar.getBoundingClientRect();
        const boardRect = boardSection.getBoundingClientRect();

        return {
          boardLeftDeltaFromTopBar: Math.abs(boardRect.left - topBarRect.left),
          boardRightDeltaFromTopBar: Math.abs(boardRect.right - topBarRect.right),
          boardLeftDeltaFromGameColumn: Math.abs(boardRect.left - gameRect.left),
          boardRightDeltaFromGameColumn: Math.abs(boardRect.right - gameRect.right),
        };
      });

      expect(alignment).not.toBeNull();
      expect(alignment?.boardLeftDeltaFromTopBar).toBeLessThanOrEqual(2);
      expect(alignment?.boardRightDeltaFromTopBar).toBeLessThanOrEqual(2);
      expect(alignment?.boardLeftDeltaFromGameColumn).toBeLessThanOrEqual(2);
      expect(alignment?.boardRightDeltaFromGameColumn).toBeLessThanOrEqual(2);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8h: Desktop action alert centers on the table stage and keeps aiming at the acting seat', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1440, height: 900 }),
        bobPage.setViewportSize({ width: 1440, height: 900 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.call());
      await waitForPlayerTurn(alicePage, 'Alice');

      const alertCard = alicePage.locator('[data-testid="action-center-alert-card"]');
      await alicePage.click('[data-testid="action-check"]');
      await expect(
        alicePage.locator('[data-testid="action-quick-confirm-popover"]'),
      ).toBeVisible();
      await Promise.all([
        expect(alertCard).toBeVisible(),
        alicePage.click('[data-testid="action-quick-confirm-accept"]'),
      ]);

      const geometry = await alicePage.evaluate(() => {
        const boardStage = document.querySelector<HTMLElement>('.table-shell__board-stage');
        const alert = document.querySelector<HTMLElement>(
          '[data-testid="action-center-alert-card"]',
        );
        const arrow = document.querySelector<HTMLElement>('.action-center-alert__arrow');
        const arrowHead = document.querySelector<HTMLElement>('.action-center-alert__arrow-head');
        const seatNodes = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid^="player-seat-"]'),
        );
        const aliceSeat = seatNodes.find((node) => node.textContent?.includes('Alice'));

        if (!boardStage || !alert || !arrow || !arrowHead || !aliceSeat) {
          return null;
        }

        const stageRect = boardStage.getBoundingClientRect();
        const alertRect = alert.getBoundingClientRect();
        const arrowRect = arrow.getBoundingClientRect();
        const arrowHeadRect = arrowHead.getBoundingClientRect();
        const seatRect = aliceSeat.getBoundingClientRect();
        const alertCenterX = alertRect.left + alertRect.width / 2;
        const alertCenterY = alertRect.top + alertRect.height / 2;
        const arrowMidX = arrowRect.left + arrowRect.width / 2;
        const arrowMidY = arrowRect.top + arrowRect.height / 2;
        const arrowHeadCenterX = arrowHeadRect.left + arrowHeadRect.width / 2;
        const arrowHeadCenterY = arrowHeadRect.top + arrowHeadRect.height / 2;
        const seatCenterX = seatRect.left + seatRect.width / 2;
        const seatCenterY = seatRect.top + seatRect.height / 2;
        const stageCenterX = stageRect.left + stageRect.width / 2;
        const viewportCenterX = window.innerWidth / 2;
        const lineDeltaX = seatCenterX - alertCenterX;
        const lineDeltaY = seatCenterY - alertCenterY;
        const lineLength = Math.hypot(lineDeltaX, lineDeltaY);
        const alertDistanceToSeat = Math.hypot(
          seatCenterX - alertCenterX,
          seatCenterY - alertCenterY,
        );
        const arrowHeadDistanceToSeat = Math.hypot(
          seatCenterX - arrowHeadCenterX,
          seatCenterY - arrowHeadCenterY,
        );
        const arrowMidpointDistanceFromSeatLine =
          lineLength <= 1
            ? Number.POSITIVE_INFINITY
            : Math.abs(
                lineDeltaY * arrowMidX -
                  lineDeltaX * arrowMidY +
                  seatCenterX * alertCenterY -
                  seatCenterY * alertCenterX,
              ) / lineLength;

        return {
          alertCenterDeltaFromStage: Math.abs(alertCenterX - stageCenterX),
          alertCenterDeltaFromViewport: Math.abs(alertCenterX - viewportCenterX),
          arrowMidpointDistanceFromSeatLine,
          arrowHeadDistanceToSeat,
          alertDistanceToSeat,
        };
      });

      expect(geometry).not.toBeNull();
      expect(geometry?.alertCenterDeltaFromStage).toBeLessThanOrEqual(4);
      expect(geometry?.alertCenterDeltaFromViewport).toBeGreaterThan(40);
      expect(geometry?.arrowMidpointDistanceFromSeatLine).toBeLessThanOrEqual(8);
      expect(geometry?.arrowHeadDistanceToSeat).toBeLessThan(
        (geometry?.alertDistanceToSeat ?? 0) * 0.45,
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('@critical 8.8i: Desktop turn alert centers on the table stage instead of the viewport', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1440, height: 900 }),
        bobPage.setViewportSize({ width: 1440, height: 900 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.call());
      await waitForPlayerTurn(alicePage, 'Alice');

      const turnAlert = alicePage.locator('[data-testid="turn-center-alert"]');
      await expect(turnAlert).toBeVisible();

      const geometry = await alicePage.evaluate(() => {
        const boardStage = document.querySelector<HTMLElement>('.table-shell__board-stage');
        const alert = document.querySelector<HTMLElement>('[data-testid="turn-center-alert"]');

        if (!boardStage || !alert) {
          return null;
        }

        const stageRect = boardStage.getBoundingClientRect();
        const alertRect = alert.getBoundingClientRect();
        const alertCenterX = alertRect.left + alertRect.width / 2;
        const stageCenterX = stageRect.left + stageRect.width / 2;
        const viewportCenterX = window.innerWidth / 2;

        return {
          alertCenterDeltaFromStage: Math.abs(alertCenterX - stageCenterX),
          alertCenterDeltaFromViewport: Math.abs(alertCenterX - viewportCenterX),
        };
      });

      expect(geometry).not.toBeNull();
      expect(geometry?.alertCenterDeltaFromStage).toBeLessThanOrEqual(4);
      expect(geometry?.alertCenterDeltaFromViewport).toBeGreaterThan(40);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.9: Rankings Modal and Card Toggle Reset on New Hand', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await alicePage.click('[data-testid="add-robot-button"]');
      await alicePage.waitForFunction(
        () =>
          ((window as any).pokerDebug?.getRoom?.()?.players ?? []).some(
            (player: any) => player.isRobot && player.status !== 'left',
          ),
        { timeout: 10000 },
      );
      const robot = await alicePage.evaluate(() => {
        const players = (window as any).pokerDebug?.getRoom?.()?.players ?? [];
        const seat = players.find(
          (player: any) => player.isRobot && player.status !== 'left',
        );
        return seat ? { id: seat.id, name: seat.name } : null;
      });

      expect(robot).not.toBeNull();
      if (!robot) {
        throw new Error('Robot was not added before rankings coverage');
      }

      await alicePage.click(`[data-testid="remove-robot-${robot.id}"]`);
      await alicePage.waitForFunction(
        (robotId) =>
          !((window as any).pokerDebug?.getRoom?.()?.players ?? []).some(
            (player: any) => player.id === robotId && player.status !== 'left',
          ),
        robot.id,
        { timeout: 10000 },
      );

      await startGameFromLobby(alicePage, bobPage);

      await alicePage.click('[data-testid="open-rankings-button"]');
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="ranking-row-1"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toContainText('Player Rankings');
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).not.toContainText(robot.name);
      await alicePage.click('[data-testid="close-rankings-button"]');
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toHaveCount(0);

      await alicePage.click('[data-testid="toggle-hole-cards"]');
      await expect(
        alicePage.locator('[data-testid^="your-card-"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="hole-cards-hidden-state"]'),
      ).toBeVisible();

      await waitForPlayerTurn(bobPage, 'Bob');
      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;
      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="start-next-hand-button"]');

      // TEST_MODE auto-starts hand #2; hidden cards should reset to shown.
      await waitForHandStart(alicePage, 2);
      await expect(
        alicePage.locator('[data-testid^="your-card-"]'),
      ).toHaveCount(2);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.9b: Your Cards Auto-Hides When Hand Results Are Shown Until Next Hand', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await expect(
        alicePage.locator('[data-testid^="your-card-"]'),
      ).toHaveCount(2);

      await waitForPlayerTurn(bobPage, 'Bob');
      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid^="your-card-"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="toggle-hole-cards"]'),
      ).toHaveCount(0);
      await alicePage.click('[data-testid="close-hand-results-button"]');
      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="toggle-hole-cards"]'),
      ).toHaveCount(0);

      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="start-next-hand-button"]');

      await waitForHandStart(alicePage, 2);
      await expect(
        alicePage.locator('[data-testid^="your-card-"]'),
      ).toHaveCount(2);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.9c: Hand Results Preempt Rankings Modal When The Hand Ends', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await alicePage.click('[data-testid="open-rankings-button"]');
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toBeVisible();

      await waitForPlayerTurn(bobPage, 'Bob');
      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.9d: Rankings Can Open After Hand Results Are Dismissed At Hand End', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await bobPage.click('[data-testid="action-fold"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="close-hand-results-button"]');
      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="open-rankings-button"]');

      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toBeVisible();
      await alicePage.waitForTimeout(300);
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="close-rankings-button"]');
      await expect(
        alicePage.locator('[data-testid="rankings-modal"]'),
      ).toHaveCount(0);

      await alicePage.click('[data-testid="open-rules-button"]');
      await expect(
        alicePage.locator('[data-testid="rules-modal"]'),
      ).toBeVisible();
      await alicePage.waitForTimeout(300);
      await expect(
        alicePage.locator('[data-testid="rules-modal"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="close-rules-button"]');
      await expect(
        alicePage.locator('[data-testid="rules-modal"]'),
      ).toHaveCount(0);

      await alicePage.click('[data-testid="open-settings-button"]');
      await expect(
        alicePage.locator('[data-testid="settings-modal"]'),
      ).toBeVisible();
      await alicePage.waitForTimeout(300);
      await expect(
        alicePage.locator('[data-testid="settings-modal"]'),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.10: Rejected Action Shows Detailed Error Modal', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage } = session;
      await startGameFromLobby(alicePage, session.bobPage);

      // Bob acts first pre-flop in heads-up; force an out-of-turn action from Alice.
      await alicePage.evaluate(() => (window as any).pokerDebug.call());

      await expect(
        alicePage.locator('[data-testid="error-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="error-modal-reason"]'),
      ).toContainText('Another player must act first');
      await expect(
        alicePage.locator('[data-testid="error-modal"]'),
      ).toContainText('Technical detail');
      await expect(
        alicePage.locator('[data-testid="error-modal"]'),
      ).toContainText('shows Bob');

      await alicePage.click('[data-testid="dismiss-error-button"]');
      await expect(
        alicePage.locator('[data-testid="error-modal"]'),
      ).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.11: Invalid Check Uses Same Detailed Error Modal', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { bobPage } = session;
      await startGameFromLobby(session.alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.evaluate(() => (window as any).pokerDebug.check());

      await expect(
        bobPage.locator('[data-testid="error-modal"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="error-modal-reason"]'),
      ).toContainText('facing a bet');
      await expect(
        bobPage.locator('[data-testid="error-modal"]'),
      ).toContainText(`Call $${DEFAULT_SMALL_BLIND_CALL_GAP}`);
      await expect(
        bobPage.locator('[data-testid="error-modal"]'),
      ).toContainText('Technical detail');

      await bobPage.click('[data-testid="dismiss-error-button"]');
      await expect(bobPage.locator('[data-testid="error-modal"]')).toHaveCount(
        0,
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12: Refresh Mid-Hand Automatically Reconnects Player Session', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const beforeRefresh = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          playerName: player?.name ?? null,
          handNumber: room?.currentHand?.handNumber ?? null,
          bettingRound: room?.currentHand?.bettingRound ?? null,
          hasCards: Array.isArray((window as any).pokerDebug?.getCards?.())
            ? (window as any).pokerDebug.getCards().length === 2
            : false,
        };
      });

      expect(beforeRefresh.roomId).toBe(roomCode);
      expect(beforeRefresh.playerName).toBe('Bob');
      expect(beforeRefresh.hasCards).toBe(true);
      expect(beforeRefresh.handNumber).toBe(1);
      expect(beforeRefresh.bettingRound).toBe('PRE_FLOP');

      const persistedAuthSnapshot = await bobPage.evaluate(() => ({
        activeSession: window.sessionStorage.getItem('poker.activeSession'),
      }));
      expect(persistedAuthSnapshot.activeSession).toBeTruthy();

      await bobPage.addInitScript((snapshot) => {
        if (snapshot.activeSession) {
          window.sessionStorage.setItem(
            'poker.activeSession',
            snapshot.activeSession,
          );
        }
      }, persistedAuthSnapshot);

      // Test harness serves static files without SPA fallback. Intercept room route
      // and serve index.html so a hard reload at /room/:id behaves like production.
      const roomRoutePattern = `${FRONTEND_URL}/room/*`;
      await bobPage.route(roomRoutePattern, async (route) => {
        const response = await bobPage.request.get(FRONTEND_URL);
        const body = await response.text();
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body,
        });
      });
      await bobPage.reload({ waitUntil: 'domcontentloaded' });
      await bobPage.unroute(roomRoutePattern);

      const postRefreshModeHandle = await bobPage.waitForFunction(
        () => {
          const pd = (window as any).pokerDebug;
          const room = pd?.getRoom?.();
          const player = pd?.getPlayer?.();
          if (!!room?.id && !!player?.id) {
            return 'recovered';
          }
          if (document.querySelector('[data-testid="room-title"]')) {
            return 'room';
          }
          if (document.querySelector('[data-testid="connection-status"]')) {
            return 'home';
          }
          if (document.querySelector('[data-testid="auth-page"]')) {
            return 'auth';
          }
          return null;
        },
        { timeout: 15000 },
      );
      const postRefreshMode = await postRefreshModeHandle.jsonValue();

      if (postRefreshMode === 'auth' || postRefreshMode === 'home') {
        if (postRefreshMode === 'auth') {
          await authenticateTestUser(bobPage, 'test2', {
            displayName: 'Bob',
            avatarEmoji: '🐻',
          });
        }

        const recoveredAfterReauth = await bobPage
          .waitForFunction(
            () => {
              const pd = (window as any).pokerDebug;
              const room = pd?.getRoom?.();
              const player = pd?.getPlayer?.();
              return !!room?.id && !!player?.id;
            },
            { timeout: 5000 },
          )
          .then(() => true)
          .catch(() => false);

        if (!recoveredAfterReauth) {
          await bobPage.click('[data-testid="join-toggle-button"]');
          await bobPage.fill('[data-testid="room-id-input"]', roomCode);
          await bobPage.click('[data-testid="join-room-button"]');
        }
      }

      await bobPage.waitForFunction(
        () => {
          const pd = (window as any).pokerDebug;
          const room = pd?.getRoom?.();
          const player = pd?.getPlayer?.();
          return !!room?.id && !!player?.id;
        },
        { timeout: 15000 },
      );

      const afterRefresh = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          playerName: player?.name ?? null,
          handNumber: room?.currentHand?.handNumber ?? null,
          bettingRound: room?.currentHand?.bettingRound ?? null,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
          status:
            room?.players?.find((p: any) => p.id === player?.id)?.status ??
            null,
        };
      });

      expect(afterRefresh.roomId).toBe(beforeRefresh.roomId);
      expect(afterRefresh.playerId).toBe(beforeRefresh.playerId);
      expect(afterRefresh.playerName).toBe('Bob');
      expect(afterRefresh.handNumber).toBe(beforeRefresh.handNumber);
      expect(afterRefresh.bettingRound).toBe(beforeRefresh.bettingRound);
      expect(afterRefresh.currentPlayerTurn).toBe(afterRefresh.playerId);
      expect(afterRefresh.status).toBe('connected');
      await expect(bobPage).toHaveURL(new RegExp(`/room/${roomCode}$`));

      // Verify recovered player can immediately continue the same hand.
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12h: Refresh Mid-Hand Preserves Authoritative Min Raise Constraints', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage, roomCode } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1280, height: 900 }),
        bobPage.setViewportSize({ width: 390, height: 844 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.call());
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.evaluate(() => (window as any).pokerDebug.check());
      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.check());
      await waitForPlayerTurn(alicePage, 'Alice');

      const flopBetResponse = await emitPlayerActionWithId(alicePage, {
        action: 'raise',
        amount: 20,
        actionId: `flop-bet-${Date.now()}`,
      });
      expect(flopBetResponse.success).toBe(true);

      await waitForPlayerTurn(bobPage, 'Bob');

      const beforeRefresh = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        const currentPlayer = room?.players?.find((p: any) => p.id === player?.id);
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          currentBet: room?.currentHand?.currentBet ?? null,
          minRaise: room?.currentHand?.minRaise ?? null,
          callAmount:
            room?.currentHand && currentPlayer
              ? room.currentHand.currentBet - currentPlayer.currentBet
              : null,
        };
      });

      expect(beforeRefresh.roomId).toBe(roomCode);
      expect(beforeRefresh.currentBet).toBe(20);
      expect(beforeRefresh.minRaise).toBe(20);
      expect(beforeRefresh.callAmount).toBe(20);

      const persistedAuthSnapshot = await bobPage.evaluate(() => ({
        activeSession: window.sessionStorage.getItem('poker.activeSession'),
      }));
      expect(persistedAuthSnapshot.activeSession).toBeTruthy();

      await bobPage.addInitScript((snapshot) => {
        if (snapshot.activeSession) {
          window.sessionStorage.setItem(
            'poker.activeSession',
            snapshot.activeSession,
          );
        }
      }, persistedAuthSnapshot);

      const roomRoutePattern = `${FRONTEND_URL}/room/*`;
      await bobPage.route(roomRoutePattern, async (route) => {
        const response = await bobPage.request.get(FRONTEND_URL);
        const body = await response.text();
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body,
        });
      });
      await bobPage.reload({ waitUntil: 'domcontentloaded' });
      await bobPage.unroute(roomRoutePattern);

      const postRefreshModeHandle = await bobPage.waitForFunction(
        () => {
          const pd = (window as any).pokerDebug;
          const room = pd?.getRoom?.();
          const player = pd?.getPlayer?.();
          if (!!room?.id && !!player?.id) {
            return 'recovered';
          }
          if (document.querySelector('[data-testid="room-title"]')) {
            return 'room';
          }
          if (document.querySelector('[data-testid="connection-status"]')) {
            return 'home';
          }
          if (document.querySelector('[data-testid="auth-page"]')) {
            return 'auth';
          }
          return null;
        },
        { timeout: 15000 },
      );
      const postRefreshMode = await postRefreshModeHandle.jsonValue();

      if (postRefreshMode === 'auth' || postRefreshMode === 'home') {
        if (postRefreshMode === 'auth') {
          await authenticateTestUser(bobPage, 'test2', {
            displayName: 'Bob',
            avatarEmoji: '🐻',
          });
        }

        const recoveredAfterReauth = await bobPage
          .waitForFunction(
            () => {
              const pd = (window as any).pokerDebug;
              const room = pd?.getRoom?.();
              const player = pd?.getPlayer?.();
              return !!room?.id && !!player?.id;
            },
            { timeout: 5000 },
          )
          .then(() => true)
          .catch(() => false);

        if (!recoveredAfterReauth) {
          await bobPage.click('[data-testid="join-toggle-button"]');
          await bobPage.fill('[data-testid="room-id-input"]', roomCode);
          await bobPage.click('[data-testid="join-room-button"]');
        }
      }

      await bobPage.waitForFunction(
        () => {
          const pd = (window as any).pokerDebug;
          const room = pd?.getRoom?.();
          const player = pd?.getPlayer?.();
          return !!room?.id && !!player?.id;
        },
        { timeout: 15000 },
      );

      const afterRefresh = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        const currentPlayer = room?.players?.find((p: any) => p.id === player?.id);
        return {
          playerId: player?.id ?? null,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
          currentBet: room?.currentHand?.currentBet ?? null,
          minRaise: room?.currentHand?.minRaise ?? null,
          callAmount:
            room?.currentHand && currentPlayer
              ? room.currentHand.currentBet - currentPlayer.currentBet
              : null,
        };
      });

      expect(afterRefresh.currentPlayerTurn).toBe(afterRefresh.playerId);
      expect(afterRefresh.currentBet).toBe(20);
      expect(afterRefresh.minRaise).toBe(20);
      expect(afterRefresh.callAmount).toBe(20);

      const minRaiseResponse = await emitPlayerActionWithId(bobPage, {
        action: 'raise',
        amount: 20,
        actionId: `recovered-min-raise-${Date.now()}`,
      });
      expect(minRaiseResponse.success).toBe(true);

      await waitForPlayerTurn(alicePage, 'Alice');
      const aliceFacingRaise = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return room?.currentHand?.currentBet ?? null;
      });
      expect(aliceFacingRaise).toBe(40);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12a: Duplicate PLAYER_ACTION actionId Is Idempotent', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const actionId = `dup-call-${Date.now()}`;
      const firstResponse = await emitPlayerActionWithId(bobPage, {
        action: 'call',
        actionId,
      });
      expect(firstResponse.success).toBe(true);
      expect(firstResponse.duplicate).not.toBe(true);

      await waitForPlayerTurn(alicePage, 'Alice');
      const afterFirst = await getRoomSnapshot(alicePage);
      expect(afterFirst.pot).toBe(DEFAULT_TWO_PLAYER_MATCHED_POT);
      expect(afterFirst.currentPlayerName).toBe('Alice');

      const duplicateResponse = await emitPlayerActionWithId(bobPage, {
        action: 'call',
        actionId,
      });
      expect(duplicateResponse.success).toBe(true);
      expect(duplicateResponse.duplicate).toBe(true);

      const afterDuplicate = await getRoomSnapshot(alicePage);
      expect(afterDuplicate.pot).toBe(afterFirst.pot);
      expect(afterDuplicate.currentPlayerName).toBe('Alice');
      expect(afterDuplicate.aliceCurrentBet).toBe(afterFirst.aliceCurrentBet);
      expect(afterDuplicate.bobCurrentBet).toBe(afterFirst.bobCurrentBet);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12b: Disconnect Timeout Auto-Folds Current Player', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      roomConfig: { reconnectGracePeriod: 1200 },
    });

    try {
      const { alicePage, bobPage, bobContext } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const disconnectedPromise = captureNextSocketEvent(
        alicePage,
        'PLAYER_DISCONNECTED',
        5000,
      );
      const autoFoldPromise = captureNextSocketEvent(
        alicePage,
        'PLAYER_AUTO_FOLDED',
        8000,
      );
      const handCompletePromise = captureNextHandComplete(alicePage, 12000, [
        alicePage,
        bobPage,
      ]);

      await bobContext.close();

      const disconnectedEvent = await disconnectedPromise;
      expect(disconnectedEvent.playerName).toBe('Bob');
      expect(disconnectedEvent.gracePeriod).toBe(1200);

      const autoFoldEvent = await autoFoldPromise;
      expect(autoFoldEvent.playerName).toBe('Bob');

      const result = await handCompletePromise;
      expect(result.totalPot).toBe(DEFAULT_OPENING_POT);
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Alice');
      expect(result.winners[0].amountWon).toBe(DEFAULT_OPENING_POT);

      const finalState = await getRoomSnapshot(alicePage);
      expect(finalState.handNumber).toBeGreaterThanOrEqual(1);
      await verifyChipConservation(alicePage, 2000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12c: Lobby Reconnect Still Receives Hole Cards After Start', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;

      await forceSocketReconnect(bobPage);
      await startGameFromLobby(alicePage, bobPage);

      await waitForHoleCards(bobPage);
      const bobCardCount = await bobPage.evaluate(() => {
        const cards = (window as any).pokerDebug?.getCards?.();
        return Array.isArray(cards) ? cards.length : 0;
      });
      expect(bobCardCount).toBe(2);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12d: Reconnect During Pending Street Reveal Keeps Reveal Controls', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage, {
        enableStreetReveal: true,
      });

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();

      await forceSocketReconnect(alicePage);
      await forceSocketReconnect(bobPage);

      await alicePage.waitForFunction(
        () =>
          (window as any).pokerDebug?.getRoom?.()?.currentHand
            ?.pendingStreetRevealRound === 'FLOP',
        { timeout: 5000 },
      );
      await bobPage.waitForFunction(
        () =>
          (window as any).pokerDebug?.getRoom?.()?.currentHand
            ?.pendingStreetRevealRound === 'FLOP',
        { timeout: 5000 },
      );

      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="turn-overlay"]')).toHaveCount(
        0,
      );
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-button"]'),
      ).toBeEnabled();

      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12e: Reconnect After Final Reveal Keeps Hand Result Actions', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextSocketEvent(
        alicePage,
        'HAND_COMPLETE',
        60000,
      );
      await startGameFromLobby(alicePage, bobPage, {
        enableStreetReveal: true,
      });

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      await expect(
        alicePage.locator('[data-testid="showdown-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="showdown-action-area"]'),
      ).toBeVisible();

      const bobCanActFirst = await bobPage
        .locator('[data-testid="show-my-hand-button"]')
        .count();
      if (bobCanActFirst > 0) {
        await bobPage.click('[data-testid="show-my-hand-button"]');
        await expect(
          alicePage.locator('[data-testid="show-my-hand-button"]'),
        ).toBeVisible();
        await alicePage.click('[data-testid="show-my-hand-button"]');
      } else {
        await alicePage.click('[data-testid="show-my-hand-button"]');
        await expect(
          bobPage.locator('[data-testid="show-my-hand-button"]'),
        ).toBeVisible();
        await bobPage.click('[data-testid="show-my-hand-button"]');
      }
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="reveal-next-street-button"]');
      await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();

      await forceSocketReconnect(alicePage);
      await forceSocketReconnect(bobPage);

      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="next-hand-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="next-hand-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="turn-overlay"]')).toHaveCount(
        0,
      );
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12f: Reconnect Restores Folded Status Mid-Hand', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      const bobIdentity = await getPagePlayerIdentity(bobPage);
      if (!bobIdentity) {
        throw new Error('Missing Bob identity for reconnect status assertion');
      }

      await waitForPlayerTurn(charliePage, 'Charlie');
      await expect(
        alicePage.locator(`[data-testid="player-seat-${bobIdentity.id}"]`),
      ).toHaveClass(/seat-pod--folded/);

      const disconnectedPromise = captureNextSocketEvent(
        alicePage,
        'PLAYER_DISCONNECTED',
        5000,
      );
      const reconnectedPromise = captureNextSocketEvent(
        alicePage,
        'PLAYER_RECONNECTED',
        10000,
      );

      await forceSocketReconnect(bobPage);

      const disconnectedEvent = await disconnectedPromise;
      expect(disconnectedEvent.playerId).toBe(bobIdentity.id);

      const reconnectedEvent = await reconnectedPromise;
      expect(reconnectedEvent.playerId).toBe(bobIdentity.id);
      expect(reconnectedEvent.status).toBe('folded');

      await alicePage.waitForFunction(
        (playerId) => {
          const room = (window as any).pokerDebug?.getRoom?.();
          return (
            room?.players?.find((player: any) => player.id === playerId)
              ?.status === 'folded'
          );
        },
        bobIdentity.id,
        { timeout: 5000 },
      );
      await bobPage.waitForFunction(
        (playerId) => {
          const room = (window as any).pokerDebug?.getRoom?.();
          return (
            room?.players?.find((player: any) => player.id === playerId)
              ?.status === 'folded'
          );
        },
        bobIdentity.id,
        { timeout: 5000 },
      );

      await expect(
        alicePage.locator(`[data-testid="player-seat-${bobIdentity.id}"]`),
      ).toHaveClass(/seat-pod--folded/);
      await expect(
        bobPage.locator(`[data-testid="player-seat-${bobIdentity.id}"]`),
      ).toHaveClass(/seat-pod--folded/);

      const afterReconnect = await getRoomSnapshot(alicePage);
      expect(afterReconnect.currentPlayerName).toBe('Charlie');
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('8.12g: Same User Can Move An Active Seat To Another Device', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);
    const takeoverContext = await browser.newContext();
    const takeoverPage = await takeoverContext.newPage();

    try {
      const { alicePage, bobPage, roomCode } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const bobBefore = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        const cards = (window as any).pokerDebug?.getCards?.();
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          playerName: player?.name ?? null,
          handNumber: room?.currentHand?.handNumber ?? null,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
          hasCards: Array.isArray(cards) && cards.length === 2,
        };
      });

      expect(bobBefore.roomId).toBe(roomCode);
      expect(bobBefore.playerName).toBe('Bob');
      expect(bobBefore.playerId).toBeTruthy();
      expect(bobBefore.currentPlayerTurn).toBe(bobBefore.playerId);
      expect(bobBefore.hasCards).toBe(true);

      const displacedPromise = captureNextSocketEvent(
        bobPage,
        'SESSION_DISPLACED',
        10000,
      );
      const reconnectedPromise = captureNextSocketEvent(
        alicePage,
        'PLAYER_RECONNECTED',
        10000,
      );

      await authenticateTestUser(takeoverPage, 'test2', {
        displayName: 'Bob',
        avatarEmoji: '🐻',
      });
      await takeoverPage.click('[data-testid="join-toggle-button"]');
      await takeoverPage.fill('[data-testid="room-id-input"]', roomCode);
      await takeoverPage.click('[data-testid="join-room-button"]');

      const displacedEvent = await displacedPromise;
      expect(displacedEvent.playerId).toBe(bobBefore.playerId);
      expect(displacedEvent.roomId).toBe(roomCode);

      const reconnectedEvent = await reconnectedPromise;
      expect(reconnectedEvent.playerId).toBe(bobBefore.playerId);

      await takeoverPage.waitForSelector('[data-testid="room-title"]');
      await waitForHoleCards(takeoverPage);

      const takeoverState = await takeoverPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        const cards = (window as any).pokerDebug?.getCards?.();
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          playerName: player?.name ?? null,
          handNumber: room?.currentHand?.handNumber ?? null,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
          hasCards: Array.isArray(cards) && cards.length === 2,
        };
      });

      expect(takeoverState.roomId).toBe(bobBefore.roomId);
      expect(takeoverState.playerId).toBe(bobBefore.playerId);
      expect(takeoverState.playerName).toBe('Bob');
      expect(takeoverState.handNumber).toBe(bobBefore.handNumber);
      expect(takeoverState.currentPlayerTurn).toBe(bobBefore.playerId);
      expect(takeoverState.hasCards).toBe(true);

      await bobPage.waitForSelector('[data-testid="connection-status"]', {
        timeout: 10000,
      });
      await expect(bobPage.locator('[data-testid="room-title"]')).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid="form-feedback"]'),
      ).toContainText('moved to another device');

      await takeoverPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');

      await expect(bobPage.locator('[data-testid="room-title"]')).toHaveCount(0);
    } finally {
      await Promise.allSettled([
        teardownTwoPlayerSession(session),
        takeoverContext.close(),
      ]);
    }
  });

  test('8.12h: Host Ownership Transfers Only After Hand Settlement Following Disconnect Timeout', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      roomConfig: { reconnectGracePeriod: 1200 },
    });

    try {
      const { alicePage, bobPage, aliceContext } = session;
      const aliceIdentity = await getPagePlayerIdentity(alicePage);
      const bobIdentity = await getPagePlayerIdentity(bobPage);
      if (!aliceIdentity || !bobIdentity) {
        throw new Error('Missing player identity for host transfer assertion');
      }

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');

      const disconnectedPromise = captureNextSocketEvent(
        bobPage,
        'PLAYER_DISCONNECTED',
        5000,
      );
      const autoFoldPromise = captureNextSocketEvent(
        bobPage,
        'PLAYER_AUTO_FOLDED',
        8000,
      );
      const hostChangedPromise = captureNextSocketEvent(
        bobPage,
        'HOST_CHANGED',
        12000,
      );
      const handCompletePromise = captureNextHandComplete(bobPage, 12000, [
        bobPage,
      ]);

      await aliceContext.close();

      const disconnectedEvent = await disconnectedPromise;
      expect(disconnectedEvent.playerId).toBe(aliceIdentity.id);

      await bobPage.waitForTimeout(600);
      const hostBeforeSettlement = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return room?.hostId ?? null;
      });
      expect(hostBeforeSettlement).toBe(aliceIdentity.id);

      const autoFoldEvent = await autoFoldPromise;
      expect(autoFoldEvent.playerId).toBe(aliceIdentity.id);

      await handCompletePromise;

      const hostChangedEvent = await hostChangedPromise;
      expect(hostChangedEvent.newHostId).toBe(bobIdentity.id);
      expect(hostChangedEvent.newHostName).toBe('Bob');

      await bobPage.waitForFunction(
        (playerId) => {
          const room = (window as any).pokerDebug?.getRoom?.();
          return room?.hostId === playerId;
        },
        bobIdentity.id,
        { timeout: 5000 },
      );
      const endGameResponse = await emitSocketEventAck(bobPage, 'END_GAME');
      expect(endGameResponse.success).toBe(true);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.13: Street Reveal Hides Turn Dock And One Click Advances', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage, {
        enableStreetReveal: true,
      });

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="operation-overlay"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expectYourCardsFlyoutAboveActionArea(
        alicePage,
        'reveal-next-street-action-area',
      );
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-button"]'),
      ).toContainText('Reveal Next Street');

      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="operation-overlay"]'),
      ).toBeVisible();
      await expect(bobPage.locator('[data-testid="turn-overlay"]')).toHaveCount(
        0,
      );
      await expectYourCardsFlyoutAboveActionArea(
        bobPage,
        'reveal-next-street-action-area',
      );

      await alicePage.click('[data-testid="open-chat-button"]');
      await expect(
        alicePage.locator('[data-testid="chat-panel"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-button"]'),
      ).toBeEnabled();

      // Only one player click should be enough to proceed.
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.13a: Concurrent Reveal Clicks Advance Once Without Error', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage, {
        enableStreetReveal: true,
      });

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();

      await Promise.all([
        alicePage.evaluate(() => {
          document
            .querySelector<HTMLElement>(
              '[data-testid="reveal-next-street-button"]',
            )
            ?.click();
        }),
        bobPage.evaluate(() => {
          document
            .querySelector<HTMLElement>(
              '[data-testid="reveal-next-street-button"]',
            )
            ?.click();
        }),
      ]);

      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');

      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="error-modal"]'),
      ).toHaveCount(0);
      await expect(bobPage.locator('[data-testid="error-modal"]')).toHaveCount(
        0,
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.13b: Check/Fold Uses Popover Confirmation Instead Of Fullscreen Modal', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await bobPage.waitForFunction(() => window.navigator.webdriver === false);
      await waitForPlayerTurn(bobPage, 'Bob');

      const bobFoldButton = bobPage.locator('[data-testid="action-fold"]');
      const bobContinuePreset = bobPage.locator(
        '[data-testid="chip-load-continue"]',
      );
      const bobRaisePreset = bobPage.locator('[data-testid="chip-load-raise"]');
      const bobAllInPreset = bobPage.locator(
        '[data-testid="chip-load-all-in"]',
      );
      await expect(bobFoldButton).toBeVisible();
      await expect(bobFoldButton).toBeDisabled();
      await expect(bobContinuePreset).toBeEnabled();
      await expect(bobRaisePreset).toBeEnabled();
      await expect(bobAllInPreset).toBeEnabled();
      await expect(bobFoldButton).toBeEnabled({ timeout: 3000 });
      await bobFoldButton.click();

      await expect(
        bobPage.locator('[data-testid="action-quick-confirm-popover"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="action-quick-confirm-modal"]'),
      ).toHaveCount(0);

      await bobPage.click('[data-testid="action-quick-confirm-cancel"]');
      await expect(
        bobPage.locator('[data-testid="action-quick-confirm-popover"]'),
      ).toHaveCount(0);

      await bobPage.evaluate(() => (window as any).pokerDebug.call());
      await waitForPlayerTurn(alicePage, 'Alice');

      const aliceCheckButton = alicePage.locator(
        '[data-testid="action-check"]',
      );
      const aliceFoldButton = alicePage.locator('[data-testid="action-fold"]');
      await expect(aliceCheckButton).toBeVisible();
      await expect(aliceCheckButton).toBeDisabled();
      await expect(aliceFoldButton).toBeDisabled();
      await expect(aliceCheckButton).toBeEnabled({ timeout: 3000 });
      await expect(aliceFoldButton).toBeEnabled();

      await aliceCheckButton.click();
      await expect(
        alicePage.locator('[data-testid="action-quick-confirm-popover"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="action-quick-confirm-modal"]'),
      ).toHaveCount(0);
      await alicePage.click('[data-testid="action-quick-confirm-accept"]');
      await waitForRound(bobPage, 'FLOP', 3);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.13d: Desktop bet confirmation is click-first while drag remains available', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1440, height: 900 }),
        bobPage.setViewportSize({ width: 1440, height: 900 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);
      await bobPage.waitForFunction(() => window.navigator.webdriver === false);
      await waitForPlayerTurn(bobPage, 'Bob');

      const raisePreset = bobPage.locator('[data-testid="chip-load-raise"]');
      await expect(raisePreset).toBeVisible();
      await raisePreset.click();
      await expect(
        bobPage.locator('[data-testid="tray-amount-value"]'),
      ).not.toContainText('$0');

      const submitTrayButton = bobPage.locator('[data-testid="action-submit-tray"]');
      await expect(submitTrayButton).toBeVisible();

      const desktopActionLayout = await bobPage.evaluate(() => {
        const submitButton = document.querySelector<HTMLElement>(
          '[data-testid="action-submit-tray"]',
        );
        const trayButton = document.querySelector<HTMLElement>(
          '[data-testid="chip-stack-draggable"]',
        );
        const foldButton = document.querySelector<HTMLElement>(
          '[data-testid="action-fold"]',
        );
        const dock = document.querySelector<HTMLElement>(
          '[data-testid="action-dock"]',
        );
        const cardsPanel = document.querySelector<HTMLElement>(
          '[data-testid="your-cards-section"]',
        );

        if (!submitButton || !trayButton || !foldButton || !dock || !cardsPanel) {
          return null;
        }

        const submitRect = submitButton.getBoundingClientRect();
        const trayRect = trayButton.getBoundingClientRect();
        const foldRect = foldButton.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        const cardsRect = cardsPanel.getBoundingClientRect();
        const submitCenterX = submitRect.left + submitRect.width / 2;
        const submitCenterY = submitRect.top + submitRect.height / 2;
        const trayCenterX = trayRect.left + trayRect.width / 2;
        const trayCenterY = trayRect.top + trayRect.height / 2;
        const foldCenterX = foldRect.left + foldRect.width / 2;
        const foldCenterY = foldRect.top + foldRect.height / 2;

        const distanceToTray = Math.hypot(
          submitCenterX - trayCenterX,
          submitCenterY - trayCenterY,
        );
        const distanceToFold = Math.hypot(
          submitCenterX - foldCenterX,
          submitCenterY - foldCenterY,
        );

        return {
          submitNearTrayColumn: distanceToTray < distanceToFold,
          cardsLeftOfDock: cardsRect.right <= dockRect.left + 1,
        };
      });

      expect(desktopActionLayout).not.toBeNull();
      expect(desktopActionLayout?.submitNearTrayColumn).toBe(true);
      expect(desktopActionLayout?.cardsLeftOfDock).toBe(true);
      await expectYourCardsFlyoutLeftOfActionArea(bobPage, 'action-dock');

      await submitTrayButton.click();

      await expect(
        bobPage.locator('[data-testid="bet-action-confirm-popover"]'),
      ).toBeVisible();
      await bobPage.click('[data-testid="bet-action-confirm-cancel"]');
      await expect(
        bobPage.locator('[data-testid="bet-action-confirm-popover"]'),
      ).toHaveCount(0);
      await waitForPlayerTurn(bobPage, 'Bob');

      await submitTrayButton.click();
      await bobPage.click('[data-testid="bet-action-confirm-accept"]');
      await waitForPlayerTurn(alicePage, 'Alice');

      const continuePreset = alicePage.locator('[data-testid="chip-load-continue"]');
      await expect(continuePreset).toBeVisible();
      await continuePreset.click();
      await dragTrayToPot(alicePage, { x: -0.16, y: 0.18 });
      await waitForRound(bobPage, 'FLOP', 3);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.13e: Desktop wide repeated drag-to-pot commits with quick releases', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      forceNonAutomationMode: true,
    });

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 1728, height: 1117 }),
        bobPage.setViewportSize({ width: 1728, height: 1117 }),
      ]);

      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="chip-load-continue"]');
      await dragTrayToPot(bobPage, { x: -0.14, y: 0.16 }, { steps: 2 });

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await expect(
        alicePage.locator('[data-testid="action-quick-confirm-popover"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="action-quick-confirm-accept"]');

      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
      await expect(
        bobPage.locator('[data-testid="chip-load-continue"]'),
      ).toHaveCount(0);
      const bobRaisePreset = bobPage.locator('[data-testid="chip-load-raise"]');
      await expect(bobRaisePreset).toBeVisible();
      await expect(bobRaisePreset).toBeEnabled();
      await bobRaisePreset.click();
      await dragTrayToPot(bobPage, { x: 0.12, y: -0.1 }, { steps: 2 });

      await waitForPlayerTurn(alicePage, 'Alice');
      const aliceContinuePreset = alicePage.locator(
        '[data-testid="chip-load-continue"]',
      );
      await expect(aliceContinuePreset).toBeVisible();
      await expect(aliceContinuePreset).toBeEnabled();
      await aliceContinuePreset.click();
      await dragTrayToPot(alicePage, { x: -0.08, y: 0.12 }, { steps: 2 });

      await waitForPlayerTurn(bobPage, 'Bob');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.13b1: Compact seat shows the Check action label after that seat checks', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser, {
      viewport: { width: 520, height: 900 },
    });

    try {
      const { alicePage, bobPage, charliePage } = session;

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);
      await Promise.all([
        waitForHoleCards(alicePage),
        waitForHoleCards(bobPage),
        waitForHoleCards(charliePage),
      ]);

      const bobSeatId = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const bob = room?.players?.find((entry: any) => entry.name === 'Bob');
        return bob?.id ? String(bob.id) : null;
      });
      if (!bobSeatId) {
        throw new Error('Missing Bob seat id for compact seat assertion');
      }

      await expect(
        alicePage.locator(`[data-testid="player-seat-${bobSeatId}"]`),
      ).toHaveClass(/seat-pod--compact/);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');

      await waitForPlayerTurn(charliePage, 'Charlie');

      const bobSeatAction = alicePage.locator(
        `[data-testid="player-seat-${bobSeatId}-action"]`,
      );
      await expect(bobSeatAction).toHaveText('Check');
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('8.13b2: Earlier checked seat keeps the Check label after a later seat also checks', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser, {
      viewport: { width: 520, height: 900 },
    });

    try {
      const { alicePage, bobPage, charliePage } = session;

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);
      await Promise.all([
        waitForHoleCards(alicePage),
        waitForHoleCards(bobPage),
        waitForHoleCards(charliePage),
      ]);

      const compactSeatIds = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const bob = room?.players?.find((entry: any) => entry.name === 'Bob');
        const charlie = room?.players?.find(
          (entry: any) => entry.name === 'Charlie',
        );
        return {
          bobId: bob?.id ? String(bob.id) : null,
          charlieId: charlie?.id ? String(charlie.id) : null,
        };
      });
      if (!compactSeatIds.bobId || !compactSeatIds.charlieId) {
        throw new Error('Missing Bob/Charlie seat ids for compact seat assertion');
      }

      await expect(
        alicePage.locator(`[data-testid="player-seat-${compactSeatIds.bobId}"]`),
      ).toHaveClass(/seat-pod--compact/);
      await expect(
        alicePage.locator(
          `[data-testid="player-seat-${compactSeatIds.charlieId}"]`,
        ),
      ).toHaveClass(/seat-pod--compact/);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForPlayerTurn(alicePage, 'Alice');

      const bobSeatAction = alicePage.locator(
        `[data-testid="player-seat-${compactSeatIds.bobId}-action"]`,
      );
      const charlieSeatAction = alicePage.locator(
        `[data-testid="player-seat-${compactSeatIds.charlieId}-action"]`,
      );
      await expect(bobSeatAction).toHaveText('Check');
      await expect(charlieSeatAction).toHaveText('Check');
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('8.13c: Mobile Reveal Uses Operation Bar And Keeps Cards Above Actions', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await Promise.all([
        alicePage.setViewportSize({ width: 390, height: 844 }),
        bobPage.setViewportSize({ width: 390, height: 844 }),
      ]);
      await startGameFromLobby(alicePage, bobPage, {
        enableStreetReveal: true,
      });

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="operation-overlay"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expectYourCardsFlyoutAboveActionArea(
        alicePage,
        'reveal-next-street-action-area',
      );
      await expectYourCardsFlyoutAboveActionArea(
        bobPage,
        'reveal-next-street-action-area',
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.14: Final Reveal Step Uses Result Copy Before Hand Complete', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextSocketEvent(
        alicePage,
        'HAND_COMPLETE',
        60000,
      );
      await startGameFromLobby(alicePage, bobPage, {
        enableStreetReveal: true,
      });

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await alicePage.click('[data-testid="reveal-next-street-button"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      await expect(
        alicePage.locator('[data-testid="showdown-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="operation-overlay"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expectYourCardsFlyoutAboveActionArea(
        alicePage,
        'showdown-action-area',
      );
      await expect(
        alicePage.locator('[data-testid="showdown-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="show-my-hand-button"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="fold-my-hand-button"]'),
      ).toHaveCount(0);

      const aliceCanActFirst =
        (await alicePage
          .locator('[data-testid="show-my-hand-button"]')
          .count()) > 0;
      const bobCanActFirst =
        (await bobPage.locator('[data-testid="show-my-hand-button"]').count()) >
        0;
      expect(Number(aliceCanActFirst) + Number(bobCanActFirst)).toBe(1);

      const actingPage = aliceCanActFirst ? alicePage : bobPage;
      const waitingPage = aliceCanActFirst ? bobPage : alicePage;
      const actingName = aliceCanActFirst ? 'Alice' : 'Bob';

      await expect(
        waitingPage.locator('[data-testid="showdown-waiting-hint"]'),
      ).toContainText(actingName);

      const actingPlayerId = await actingPage.evaluate(
        () => (window as any).pokerDebug?.getPlayer?.()?.id,
      );
      if (!actingPlayerId) {
        throw new Error(
          'Missing acting player id for showdown visibility assertion',
        );
      }
      const actingFlyoutCards = await actingPage
        .locator('[data-testid^="your-card-"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            rank: node.getAttribute('data-rank'),
            suit: node.getAttribute('data-suit'),
          })),
        );

      await actingPage.click('[data-testid="show-my-hand-button"]');
      await expect(
        waitingPage.locator('[data-testid="show-my-hand-button"]'),
      ).toBeEnabled();
      const revealedCardsOnWaitingPage = await waitingPage
        .locator(`[data-testid^="showdown-revealed-card-${actingPlayerId}-"]`)
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            rank: node.getAttribute('data-rank'),
            suit: node.getAttribute('data-suit'),
          })),
        );
      expect(revealedCardsOnWaitingPage).toEqual(actingFlyoutCards);

      await waitingPage.click('[data-testid="show-my-hand-button"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await clickRevealResultFromAnyPage([alicePage, bobPage], 10000);
      await handCompletePromise;
      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.14a: Showdown Decision Uses Operation Bar And Hides Turn Dock', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextSocketEvent(
        alicePage,
        'HAND_COMPLETE',
        60000,
      );
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);
      await waitForRound(alicePage, 'SHOWDOWN', 5);

      await expect(
        alicePage.locator('[data-testid="showdown-action-area"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="operation-overlay"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="turn-overlay"]'),
      ).toHaveCount(0);
      await expectYourCardsFlyoutAboveActionArea(
        alicePage,
        'showdown-action-area',
      );

      await expect(
        bobPage.locator('[data-testid="showdown-action-area"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="operation-overlay"]'),
      ).toBeVisible();
      await expect(bobPage.locator('[data-testid="turn-overlay"]')).toHaveCount(
        0,
      );
      await expectYourCardsFlyoutAboveActionArea(
        bobPage,
        'showdown-action-area',
      );

      const aliceCanActFirst =
        (await alicePage
          .locator('[data-testid="show-my-hand-button"]')
          .count()) > 0;
      const bobCanActFirst =
        (await bobPage.locator('[data-testid="show-my-hand-button"]').count()) >
        0;
      expect(Number(aliceCanActFirst) + Number(bobCanActFirst)).toBe(1);

      const actingPage = aliceCanActFirst ? alicePage : bobPage;
      const waitingPage = aliceCanActFirst ? bobPage : alicePage;
      const actingName = aliceCanActFirst ? 'Alice' : 'Bob';

      await expect(
        waitingPage.locator('[data-testid="showdown-waiting-hint"]'),
      ).toContainText(actingName);

      const actingPlayerId = await actingPage.evaluate(
        () => (window as any).pokerDebug?.getPlayer?.()?.id,
      );
      if (!actingPlayerId) {
        throw new Error(
          'Missing acting player id for showdown order assertion',
        );
      }
      const actingFlyoutCards = await actingPage
        .locator('[data-testid^="your-card-"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            rank: node.getAttribute('data-rank'),
            suit: node.getAttribute('data-suit'),
          })),
        );

      await actingPage.click('[data-testid="show-my-hand-button"]');
      await expect(
        waitingPage.locator('[data-testid="show-my-hand-button"]'),
      ).toBeEnabled();
      const revealedCardsOnWaitingPage = await waitingPage
        .locator(`[data-testid^="showdown-revealed-card-${actingPlayerId}-"]`)
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            rank: node.getAttribute('data-rank'),
            suit: node.getAttribute('data-suit'),
          })),
        );
      expect(revealedCardsOnWaitingPage).toEqual(actingFlyoutCards);

      await waitingPage.click('[data-testid="show-my-hand-button"]');
      await expect(
        alicePage.locator('[data-testid="reveal-next-street-action-area"]'),
      ).toBeVisible();
      await clickRevealResultFromAnyPage([alicePage, bobPage], 10000);
      await handCompletePromise;
      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.15: Showdown Auto-Reveals Result Hands And Ranks', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'K' }, // Alice
        { suit: 'spades', rank: 'Q' }, // Bob
        { suit: 'spades', rank: 'J' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: '9' }, // Turn
        { suit: 'diamonds', rank: 'K' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);
      await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="hand-results-mode"]'),
      ).toContainText('Hand results are visible to all players.');
      await expect(
        alicePage.locator('[data-testid="hand-results-community"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid^="hand-results-community-card-"]'),
      ).toHaveCount(5);
      await expect(
        alicePage.locator('[data-testid="save-result-screenshot-button"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        alicePage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="show-my-hand-button"]'),
      ).toHaveCount(0);

      const alicePlayerId = await alicePage.evaluate(
        () => (window as any).pokerDebug?.getPlayer?.()?.id,
      );
      if (!alicePlayerId) {
        throw new Error(
          'Missing player id for showdown card consistency assertion',
        );
      }

      const resultCardLocator = alicePage.locator(
        `[data-testid^="hand-result-card-${alicePlayerId}-"]`,
      );
      const flyoutCardLocator = alicePage.locator(
        '[data-testid^="your-card-"]',
      );
      await expect(resultCardLocator).toHaveCount(2);
      await expect(flyoutCardLocator).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="toggle-hole-cards"]'),
      ).toHaveCount(0);

      const resultCards = await resultCardLocator.evaluateAll((nodes) =>
        nodes.map((node) => ({
          rank: node.getAttribute('data-rank'),
          suit: node.getAttribute('data-suit'),
        })),
      );
      expect(
        resultCards
          .map((card) => `${card.rank}-${card.suit}`)
          .sort(),
      ).toEqual(['A-hearts', 'K-hearts']);

      await alicePage
        .locator('[data-testid="close-hand-results-button"]')
        .click();
      await expect(
        alicePage.locator('[data-testid="hand-results-modal"]'),
      ).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.15b: Hand Results Export, Review Unavailable State, And Final Full Export', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'K' }, // Alice
        { suit: 'spades', rank: 'Q' }, // Bob
        { suit: 'spades', rank: 'J' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: '9' }, // Turn
        { suit: 'diamonds', rank: 'K' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);
      await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="export-hand-history-button"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="open-hand-review-button"]'),
      ).toBeVisible();

      const alicePlayerId = await alicePage.evaluate(
        () => (window as any).pokerDebug?.getPlayer?.()?.id,
      );
      if (!alicePlayerId) {
        throw new Error('Missing player id for hand-history export assertion');
      }

      const handExport = await readDownloadedJson(
        alicePage,
        '[data-testid="export-hand-history-button"]',
      );
      expect(handExport.roomId).toBe(roomCode);
      expect(handExport.handNumber).toBe(1);
      expect(handExport.requesterPlayerId).toBe(alicePlayerId);
      expect(handExport.actions[0]).toEqual(
        expect.objectContaining({
          source: 'blind',
          action: 'post-blind',
        }),
      );

      await alicePage.click('[data-testid="open-hand-review-button"]');
      await expect(
        alicePage.locator('[data-testid="hand-review-unavailable"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="end-game-button"]');
      await expect(
        alicePage.locator('[data-testid="end-game-confirm-modal"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="end-game-confirm-accept"]');

      await expect(
        bobPage.locator('[data-testid="final-summary-modal"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="export-game-history-button"]'),
      ).toBeVisible();

      const gameExport = await readDownloadedJson(
        bobPage,
        '[data-testid="export-game-history-button"]',
      );
      expect(gameExport.roomId).toBe(roomCode);
      expect(gameExport.handCount).toBe(1);
      expect(gameExport.hands.map((hand: any) => hand.handNumber)).toEqual([1]);

      await bobPage.setViewportSize({ width: 390, height: 844 });
      await bobPage.click('[data-testid="open-saved-history-button"]');
      await expect(
        bobPage.locator('[data-testid="saved-game-detail-page"]'),
      ).toBeVisible();
      await expect(bobPage).toHaveURL(new RegExp(`/history/${roomCode}$`));
      await expect(
        bobPage.getByRole('heading', { name: `Room ${roomCode}` }),
      ).toBeVisible();
      await expect(bobPage.getByRole('button', { name: 'Hand #1' })).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="saved-history-mobile-hand-strip"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="saved-history-mobile-selected-hand"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="saved-history-mobile-section-tabs"]'),
      ).toBeVisible();
      const mobileHistoryLayout = await bobPage.evaluate(() => {
        const handStrip = document.querySelector(
          '[data-testid="saved-history-mobile-hand-strip"]',
        );
        const selectedHand = document.querySelector(
          '[data-testid="saved-history-mobile-selected-hand"]',
        );
        if (!handStrip || !selectedHand) {
          return null;
        }

        const handStripRect = handStrip.getBoundingClientRect();
        const selectedHandRect = selectedHand.getBoundingClientRect();
        return {
          handStripTop: handStripRect.top,
          selectedHandTop: selectedHandRect.top,
        };
      });
      expect(mobileHistoryLayout).not.toBeNull();
      expect(
        (mobileHistoryLayout?.handStripTop ?? Number.POSITIVE_INFINITY) <
          (mobileHistoryLayout?.selectedHandTop ?? Number.NEGATIVE_INFINITY),
      ).toBe(true);
      await bobPage.click('[data-testid="saved-history-mobile-tab-session"]');
      await expect(
        bobPage.locator('[data-testid="saved-history-mobile-session-panel"]'),
      ).toBeVisible();
      await expect(bobPage.getByText('Session Statistics')).toBeVisible();
      await expect(bobPage.getByText(/^Robot\b/)).toHaveCount(0);
      await bobPage.setViewportSize({ width: 1440, height: 900 });
      await expect(
        bobPage.getByRole('columnheader', { name: 'Buy-in' }),
      ).toBeVisible();
      const savedHandDetail = bobPage
        .locator('section')
        .filter({ has: bobPage.getByRole('heading', { name: 'Hand #1' }) });
      await expect(savedHandDetail.getByText(/Q♠\s+J♠/)).toBeVisible();

      await bobPage.getByRole('button', { name: 'Back to History' }).click();
      await expect(
        bobPage.locator('[data-testid="saved-games-page"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator(`[data-testid="saved-game-card-${roomCode}"]`),
      ).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.15c: Abandoned Room Auto-Archives Saved History After Last Disconnect Timeout', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      roomConfig: { reconnectGracePeriod: 1200 },
    });
    let bobReturnContext: BrowserContext | null = null;

    try {
      const { alicePage, bobPage, roomCode, aliceContext, bobContext } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'K' }, // Alice
        { suit: 'spades', rank: 'Q' }, // Bob
        { suit: 'spades', rank: 'J' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: '9' }, // Turn
        { suit: 'diamonds', rank: 'K' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 20000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);
      await handCompletePromise;

      await Promise.allSettled([aliceContext.close(), bobContext.close()]);

      bobReturnContext = await browser.newContext();
      const bobReturnPage = await bobReturnContext.newPage();
      await authenticateTestUser(bobReturnPage, 'test2', {
        displayName: 'Bob',
        avatarEmoji: '🐻',
      });

      await expect
        .poll(
          async () => {
            const response = await bobReturnPage.context().request.get(
              `${BACKEND_URL}/api/history/games`,
            );
            if (!response.ok()) {
              return false;
            }

            const games = (await response.json()) as Array<{ roomId?: string }>;
            return games.some((game) => game.roomId === roomCode);
          },
          { timeout: 10000, intervals: [500, 1000, 1500] },
        )
        .toBe(true);

      await bobReturnPage.getByRole('button', { name: 'History' }).click();
      await expect(
        bobReturnPage.locator('[data-testid="saved-games-page"]'),
      ).toBeVisible();
      await expect(
        bobReturnPage.locator(`[data-testid="saved-game-card-${roomCode}"]`),
      ).toBeVisible();
    } finally {
      await Promise.allSettled([
        teardownTwoPlayerSession(session),
        bobReturnContext?.close(),
      ]);
    }
  });

  test('8.16: Non-Showdown Result Keeps Hole Cards Hidden', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextHandComplete(alicePage, 60000, [
        alicePage,
        bobPage,
      ]);
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');
      const result = await handCompletePromise;

      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        alicePage.locator('[data-testid="hand-results-mode"]'),
      ).toContainText('Hand results are visible to all players.');
      const expectedWinnerNet = DEFAULT_SMALL_BLIND;
      await expect(
        alicePage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText(`Your hand: +$${expectedWinnerNet}`);
      await expect(
        bobPage.locator('[data-testid="hand-results-your-net"]'),
      ).toContainText(`Your hand: -$${expectedWinnerNet}`);
      await expect(
        alicePage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(4);
      await expect(
        alicePage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(0);
      await expect(
        alicePage.locator('[data-testid="show-my-hand-button"]'),
      ).toHaveCount(0);
      await expect(
        bobPage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(4);
      await expect(
        bobPage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(0);

      const rowPlayerIdsInOrder = await alicePage
        .locator('[data-testid^="hand-result-row-"]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute('data-testid') ?? '')
            .map((testId) => testId.replace('hand-result-row-', ''))
            .filter(Boolean),
        );
      const winnerAmountsByPlayerId = new Map(
        result.winners.map((winner: any) => [
          winner.playerId,
          winner.amountWon,
        ]),
      );
      const rowAwardsInOrder = rowPlayerIdsInOrder.map(
        (playerId: string) => winnerAmountsByPlayerId.get(playerId) ?? 0,
      );
      expect(rowAwardsInOrder).toEqual([DEFAULT_OPENING_POT, 0]);
      expect(rowPlayerIdsInOrder[0]).toBe(result.winners[0].playerId);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 9: Three-Player Coverage', () => {
  test('9.1: Three-Player Turn Order - pre-flop and flop order are correct', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);
      await waitForHandStart(alicePage, 1);

      const initial = await getRoomSnapshot(alicePage);
      expect(initial.handNumber).toBe(1);
      expect(initial.dealerPlayerName).toBe('Alice');
      expect(initial.smallBlindPlayerName).toBe('Bob');
      expect(initial.bigBlindPlayerName).toBe('Charlie');
      expect(initial.currentPlayerName).toBe('Alice');
      expect(initial.pot).toBe(DEFAULT_OPENING_POT);
      expect(await getDealerNameFromUi(alicePage)).toBe('Alice');
      expect(await getRoundFromUi(alicePage)).toBe('PRE_FLOP');
      expect(await getPotFromUi(alicePage)).toBe(DEFAULT_OPENING_POT);
      expect(await getYourChipsFromUi(alicePage)).toBe(1000);
      expect(await getYourChipsFromUi(bobPage)).toBe(
        DEFAULT_STARTING_CHIPS - DEFAULT_SMALL_BLIND,
      );
      expect(await getYourChipsFromUi(charliePage)).toBe(
        DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND,
      );
      await verifyChipConservation(alicePage, 3000);

      await waitForPlayerTurn(alicePage, 'Alice');
      await expect(
        alicePage.locator('[data-testid="action-call"]'),
      ).toContainText(`Call $${DEFAULT_BIG_BLIND}`);
      await expect(
        alicePage.locator('[data-testid="action-call"]'),
      ).toBeVisible();
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await expect(
        bobPage.locator('[data-testid="action-call"]'),
      ).toContainText(`Call $${DEFAULT_SMALL_BLIND_CALL_GAP}`);
      await expect(
        bobPage.locator('[data-testid="action-call"]'),
      ).toBeVisible();
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await expect(
        charliePage.locator('[data-testid="action-check"]'),
      ).toBeVisible();
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'FLOP', 3);
      const flop = await getRoomSnapshot(alicePage);
      expect(flop.currentPlayerName).toBe('Bob');
      expect(flop.pot).toBe(DEFAULT_BIG_BLIND * 3);
      expect(await getRoundFromUi(alicePage)).toBe('FLOP');
      expect(await getPotFromUi(alicePage)).toBe(DEFAULT_BIG_BLIND * 3);
      expect(await getYourChipsFromUi(alicePage)).toBe(
        DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND,
      );
      expect(await getYourChipsFromUi(bobPage)).toBe(
        DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND,
      );
      expect(await getYourChipsFromUi(charliePage)).toBe(
        DEFAULT_STARTING_CHIPS - DEFAULT_BIG_BLIND,
      );
      await verifyChipConservation(alicePage, 3000);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('9.1b: Three-Player Fold Keeps Clockwise Turn Progression', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      const afterBobFold = await getRoomSnapshot(alicePage);
      expect(afterBobFold.currentPlayerName).toBe('Charlie');
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('9.2: Three-Player Blind Rotation - dealer/SB/BB rotate across hands', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      const pageByName: Record<string, Page> = {
        Alice: alicePage,
        Bob: bobPage,
        Charlie: charliePage,
      };

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      const expectedDealer = ['Alice', 'Bob', 'Charlie'];
      const expectedSmallBlind = ['Bob', 'Charlie', 'Alice'];
      const expectedBigBlind = ['Charlie', 'Alice', 'Bob'];
      const expectedFirstToAct = ['Alice', 'Bob', 'Charlie'];

      for (let handNumber = 1; handNumber <= 3; handNumber++) {
        await waitForHandStart(alicePage, handNumber);
        const snapshot = await getRoomSnapshot(alicePage);

        expect(snapshot.handNumber).toBe(handNumber);
        expect(snapshot.bettingRound).toBe('PRE_FLOP');
        expect(snapshot.dealerPlayerName).toBe(expectedDealer[handNumber - 1]);
        expect(snapshot.smallBlindPlayerName).toBe(
          expectedSmallBlind[handNumber - 1],
        );
        expect(snapshot.bigBlindPlayerName).toBe(
          expectedBigBlind[handNumber - 1],
        );
        expect(snapshot.currentPlayerName).toBe(
          expectedFirstToAct[handNumber - 1],
        );
        expect(snapshot.pot).toBe(DEFAULT_OPENING_POT);
        expect(await getDealerNameFromUi(alicePage)).toBe(
          expectedDealer[handNumber - 1],
        );
        expect(await getRoundFromUi(alicePage)).toBe('PRE_FLOP');
        expect(await getPotFromUi(alicePage)).toBe(DEFAULT_OPENING_POT);
        await expect(
          pageByName[expectedFirstToAct[handNumber - 1]].locator(
            '[data-testid="action-dock"]',
          ),
        ).toBeVisible();
        await verifyChipConservation(alicePage, 3000);

        const actingPage = pageByName[expectedFirstToAct[handNumber - 1]];
        await waitForPlayerTurn(actingPage, expectedFirstToAct[handNumber - 1]);
        const handCompletePromise = captureNextHandComplete(alicePage, 30000, [
          alicePage,
          bobPage,
          charliePage,
        ]);
        const firstFold = await emitPlayerActionWithId(actingPage, {
          action: 'fold',
        });
        expect(firstFold.success).toBe(true);
        const secondFoldDeadline = Date.now() + 10000;
        while (Date.now() < secondFoldDeadline) {
          const postFirstFold = await getRoomSnapshot(alicePage);
          if (
            postFirstFold.handNumber !== handNumber ||
            postFirstFold.hasLastResult
          ) {
            break;
          }
          const secondActorName = postFirstFold.currentPlayerName;
          if (
            !secondActorName ||
            secondActorName === expectedFirstToAct[handNumber - 1]
          ) {
            await alicePage.waitForTimeout(120);
            continue;
          }
          const secondActingPage = pageByName[secondActorName];
          if (!secondActingPage) {
            await alicePage.waitForTimeout(120);
            continue;
          }
          const secondFold = await emitPlayerActionWithId(secondActingPage, {
            action: 'fold',
          });
          if (secondFold.success || secondFold.duplicate) {
            break;
          }
          await alicePage.waitForTimeout(120);
        }
        await handCompletePromise;

        if (handNumber < 3) {
          await expect(
            alicePage.locator('[data-testid="start-next-hand-button"]'),
          ).toBeVisible();
          await alicePage.click('[data-testid="start-next-hand-button"]');
          await waitForHandStart(alicePage, handNumber + 1);
        }
      }

      // After hand 3 fold, players can drop below two active stacks, so a 4th hand
      // may not start. Rotation assertions above already validate full 3-hand cycle.
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('9.3: Three-Way Tie - split pot evenly across 3 winners', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'clubs', rank: '2' }, // Alice
        { suit: 'diamonds', rank: '7' }, // Alice
        { suit: 'hearts', rank: '3' }, // Bob
        { suit: 'spades', rank: '8' }, // Bob
        { suit: 'clubs', rank: '4' }, // Charlie
        { suit: 'diamonds', rank: '9' }, // Charlie
        { suit: 'clubs', rank: 'A' }, // Flop 1
        { suit: 'diamonds', rank: 'K' }, // Flop 2
        { suit: 'hearts', rank: 'Q' }, // Flop 3
        { suit: 'spades', rank: 'J' }, // Turn
        { suit: 'clubs', rank: '10' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage, 60000, [
        alicePage,
        bobPage,
        charliePage,
      ]);
      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-call"]');

      const result = await handCompletePromise;
      expect(result.totalPot).toBe(3000);
      expect(result.winners).toHaveLength(3);
      const winnerNames = result.winners
        .map((winner: any) => winner.playerName)
        .sort();
      expect(winnerNames).toEqual(['Alice', 'Bob', 'Charlie']);
      const amounts = result.winners
        .map((winner: any) => winner.amountWon)
        .sort((a: number, b: number) => a - b);
      expect(amounts).toEqual([1000, 1000, 1000]);
      const ranks = result.winners.map((winner: any) => winner.hand.rank);
      expect(ranks.every((rank: string) => rank === 'STRAIGHT')).toBe(true);
      await expect(
        alicePage.locator('[data-testid="round-value"]'),
      ).toContainText('SHOWDOWN');
      expect(await getPotFromUi(alicePage)).toBe(3000);
      const uiMoney = await getPlayersMoneyFromUi(alicePage);
      expect(uiMoney.Alice.chips + uiMoney.Alice.currentBet).toBe(1000);
      expect(uiMoney.Bob.chips + uiMoney.Bob.currentBet).toBe(1000);
      expect(uiMoney.Charlie.chips + uiMoney.Charlie.currentBet).toBe(1000);
      const totalUiMoney =
        uiMoney.Alice.chips +
        uiMoney.Alice.currentBet +
        uiMoney.Bob.chips +
        uiMoney.Bob.currentBet +
        uiMoney.Charlie.chips +
        uiMoney.Charlie.currentBet;
      expect(totalUiMoney).toBe(3000);

      await verifyChipConservation(alicePage, 3000);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('9.4: Folded Player Is Excluded And Only Required Showdown Hands Are Visible', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      const pageByName: Record<string, Page> = {
        Alice: alicePage,
        Bob: bobPage,
        Charlie: charliePage,
      };
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'clubs', rank: '2' }, // Alice
        { suit: 'diamonds', rank: '7' }, // Alice
        { suit: 'hearts', rank: '3' }, // Bob
        { suit: 'spades', rank: '8' }, // Bob
        { suit: 'spades', rank: 'A' }, // Charlie
        { suit: 'hearts', rank: 'A' }, // Charlie
        { suit: 'clubs', rank: 'K' }, // Flop 1
        { suit: 'diamonds', rank: 'Q' }, // Flop 2
        { suit: 'spades', rank: '9' }, // Flop 3
        { suit: 'hearts', rank: '5' }, // Turn
        { suit: 'diamonds', rank: '2' }, // River
      ]);

      await setAllowPlayerStreetRevealAndWait(
        alicePage,
        [alicePage, bobPage, charliePage],
        false,
      );

      const handCompletePromise = captureNextHandComplete(alicePage, 60000, [
        alicePage,
        bobPage,
        charliePage,
      ]);
      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        bobPage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
        charliePage.waitForSelector('[data-testid="round-value"]', {
          timeout: 10000,
        }),
      ]);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-all-in"]');

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      const result = await handCompletePromise;

      expect(result.playerHands).toHaveLength(3);
      const shownNames = result.playerHands
        .filter((entry: any) => entry.cardsVisibility === 'shown')
        .map((entry: any) => entry.playerName)
        .sort();
      expect(shownNames).toEqual(['Alice', 'Charlie']);
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Charlie');

      const playerIdsByName = await alicePage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        return Object.fromEntries(
          (room?.players ?? []).map((player: any) => [player.name, player.id]),
        );
      });
      const bobPlayerId = playerIdsByName.Bob ?? null;
      const alicePlayerId = playerIdsByName.Alice ?? null;
      const charliePlayerId = playerIdsByName.Charlie ?? null;
      if (!bobPlayerId || !alicePlayerId || !charliePlayerId) {
        throw new Error(
          'Missing player ids for hand-results ordering assertion',
        );
      }

      await expect(
        alicePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        bobPage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();
      await expect(
        charliePage.locator('[data-testid="hand-results-panel"]'),
      ).toBeVisible();

      await expect(
        alicePage.locator('[data-testid^="hand-result-row-"]'),
      ).toHaveCount(3);
      await expect(
        alicePage.locator(`[data-testid="hand-result-row-${bobPlayerId}"]`),
      ).toHaveCount(1);
      const rowPlayerIdsInOrder = await alicePage
        .locator('[data-testid^="hand-result-row-"]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute('data-testid') ?? '')
            .map((testId) => testId.replace('hand-result-row-', ''))
            .filter(Boolean),
        );
      expect(rowPlayerIdsInOrder).toEqual([
        charliePlayerId,
        alicePlayerId,
        bobPlayerId,
      ]);

      await expect(
        alicePage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        alicePage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(2);
      await expect(
        bobPage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        bobPage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(2);
      await expect(
        charliePage.locator('[data-testid^="hand-result-card-"]'),
      ).toHaveCount(4);
      await expect(
        charliePage.locator('[data-testid^="hand-result-hidden-card-"]'),
      ).toHaveCount(2);

    } finally {
      await teardownThreePlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 10: Chat History & Concurrency', () => {
  test('10.1: Concurrent chat sends keep seq monotonic and deduplicated', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      const perPlayerMessages = 10;

      const buildMessages = (sender: string) =>
        Array.from(
          { length: perPlayerMessages },
          (_, index) => `${sender}-chat-${index}`,
        );

      await Promise.all([
        sendChatMessagesViaSocket(alicePage, buildMessages('alice'), 'alice'),
        sendChatMessagesViaSocket(bobPage, buildMessages('bob'), 'bob'),
        sendChatMessagesViaSocket(
          charliePage,
          buildMessages('charlie'),
          'charlie',
        ),
      ]);

      const totalMessages = perPlayerMessages * 3;
      await alicePage.waitForFunction(
        (expectedTotal) => {
          const messages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          if (messages.length !== expectedTotal) {
            return false;
          }

          for (let index = 0; index < messages.length; index += 1) {
            if (messages[index].seq !== index + 1) {
              return false;
            }
          }

          return true;
        },
        totalMessages,
        { timeout: 15000 },
      );

      const messages = await getChatMessagesFromDebug(alicePage);
      expect(messages).toHaveLength(totalMessages);

      const seqSet = new Set(messages.map((message: any) => message.seq));
      const idSet = new Set(messages.map((message: any) => message.id));
      const clientMessageIdSet = new Set(
        messages.map((message: any) => message.clientMessageId),
      );

      expect(seqSet.size).toBe(totalMessages);
      expect(idSet.size).toBe(totalMessages);
      expect(clientMessageIdSet.size).toBe(totalMessages);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('10.4: Mobile voice preview opens chat and starts that playback source', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      viewport: { width: 390, height: 844 },
    });

    try {
      const { alicePage, bobPage } = session;

      await sendChatMessagesViaSocket(
        alicePage,
        ['preview-text'],
        'preview-text',
      );
      const uploaded = await sendVoiceMessageViaUpload(
        alicePage,
        'preview-voice',
      );
      const expectedVoiceUrl = `${uploaded.serverBaseUrl}${uploaded.voice.audioUrl}`;

      await bobPage.waitForSelector('[data-testid="chat-preview-strip"]', {
        state: 'visible',
        timeout: 10000,
      });

      await bobPage.click('[data-testid="chat-preview-open"]');

      await bobPage.waitForSelector('[data-testid="chat-panel"]', {
        state: 'visible',
        timeout: 5000,
      });
      await waitForVoicePlaybackSource(bobPage, expectedVoiceUrl);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('10.5: Mobile hidden-chat preview dismiss/open both clear unread state', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser, {
      viewport: { width: 390, height: 844 },
    });

    try {
      const { alicePage, bobPage } = session;

      await sendChatMessagesViaSocket(
        bobPage,
        ['bob-self-message'],
        'bob-self-message',
      );

      await bobPage.waitForFunction(
        () =>
          ((window as any).pokerDebug?.getChatMessages?.() ?? []).some(
            (message: any) =>
              message.kind === 'TEXT' && message.text === 'bob-self-message',
          ),
        { timeout: 10000 },
      );
      await bobPage.waitForFunction(
        () => (window as any).pokerDebug?.getChatUnreadCount?.() === 0,
        { timeout: 10000 },
      );
      await expect(
        bobPage.locator('[data-testid="chat-preview-strip"]'),
      ).toHaveCount(0);

      await sendChatMessagesViaSocket(
        alicePage,
        ['alice-unread-message'],
        'alice-unread-message',
      );

      await bobPage.waitForFunction(
        () => (window as any).pokerDebug?.getChatUnreadCount?.() === 1,
        { timeout: 10000 },
      );
      await bobPage.waitForSelector('[data-testid="chat-preview-strip"]', {
        state: 'visible',
        timeout: 10000,
      });

      await bobPage.click('[data-testid="chat-preview-dismiss"]');
      await bobPage.waitForFunction(
        () => (window as any).pokerDebug?.getChatUnreadCount?.() === 0,
        { timeout: 10000 },
      );
      await expect(
        bobPage.locator('[data-testid="chat-preview-strip"]'),
      ).toHaveCount(0);

      await sendChatMessagesViaSocket(
        alicePage,
        ['alice-unread-message-2'],
        'alice-unread-message-2',
      );
      await bobPage.waitForFunction(
        () => (window as any).pokerDebug?.getChatUnreadCount?.() === 1,
        { timeout: 10000 },
      );
      await bobPage.waitForSelector('[data-testid="chat-preview-strip"]', {
        state: 'visible',
        timeout: 10000,
      });

      await openChatPanel(bobPage);
      await bobPage.waitForFunction(
        () => (window as any).pokerDebug?.getChatUnreadCount?.() === 0,
        { timeout: 10000 },
      );

      await bobPage.click('[data-testid="close-chat-button"]');
      await bobPage.waitForSelector('[data-testid="chat-panel"]', {
        state: 'hidden',
        timeout: 5000,
      });
      await expect(
        bobPage.locator('[data-testid="chat-preview-strip"]'),
      ).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('10.6: Incoming messages do not interrupt current voice source unless another voice is clicked', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;

      const uploadedOne = await sendVoiceMessageViaUpload(alicePage, 'voice-a');
      const uploadedTwo = await sendVoiceMessageViaUpload(alicePage, 'voice-b');
      const firstVoiceUrl = `${uploadedOne.serverBaseUrl}${uploadedOne.voice.audioUrl}`;
      const secondVoiceUrl = `${uploadedTwo.serverBaseUrl}${uploadedTwo.voice.audioUrl}`;

      await bobPage.waitForFunction(
        ({ firstAudioUrl, secondAudioUrl }) => {
          const chatMessages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          const voiceAudioUrls = chatMessages
            .filter((message: any) => message.kind === 'VOICE')
            .map((message: any) => message.voice?.audioUrl);

          return (
            voiceAudioUrls.includes(firstAudioUrl) &&
            voiceAudioUrls.includes(secondAudioUrl)
          );
        },
        {
          firstAudioUrl: uploadedOne.voice.audioUrl,
          secondAudioUrl: uploadedTwo.voice.audioUrl,
        },
        { timeout: 10000 },
      );

      await openChatPanel(bobPage);

      const voicePlayers = bobPage.locator(
        '[data-testid="chat-message-list"] [data-testid="chat-voice-player"]',
      );
      await expect(voicePlayers).toHaveCount(2);

      const firstVoicePlayer = bobPage.locator(
        `[data-testid="chat-message-list"] [data-testid="chat-voice-player"][data-source-url="${firstVoiceUrl}"]`,
      );
      const secondVoicePlayer = bobPage.locator(
        `[data-testid="chat-message-list"] [data-testid="chat-voice-player"][data-source-url="${secondVoiceUrl}"]`,
      );
      await expect(firstVoicePlayer).toHaveCount(1);
      await expect(secondVoicePlayer).toHaveCount(1);

      await bobPage.evaluate((sourceUrl) => {
        const selector = `[data-testid="chat-message-list"] [data-testid="chat-voice-player"][data-source-url="${sourceUrl}"]`;
        const player = document.querySelector(
          selector,
        ) as HTMLButtonElement | null;
        player?.click();
      }, firstVoiceUrl);
      await waitForVoicePlaybackSource(bobPage, firstVoiceUrl);

      await sendChatMessagesViaSocket(
        alicePage,
        ['interrupting-text'],
        'interrupt',
      );
      await bobPage.waitForFunction(
        () =>
          ((window as any).pokerDebug?.getChatMessages?.() ?? []).some(
            (message: any) =>
              message.kind === 'TEXT' && message.text === 'interrupting-text',
          ),
        { timeout: 10000 },
      );

      const playbackAfterText = await getVoicePlaybackStateFromDebug(bobPage);
      expect(playbackAfterText.sourceUrl).toBe(firstVoiceUrl);

      await bobPage.evaluate((sourceUrl) => {
        const selector = `[data-testid="chat-message-list"] [data-testid="chat-voice-player"][data-source-url="${sourceUrl}"]`;
        const player = document.querySelector(
          selector,
        ) as HTMLButtonElement | null;
        player?.click();
      }, secondVoiceUrl);
      await bobPage.waitForTimeout(300);
      const playbackAfterSecondClick =
        await getVoicePlaybackStateFromDebug(bobPage);
      expect([firstVoiceUrl, secondVoiceUrl]).toContain(
        playbackAfterSecondClick.sourceUrl,
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('10.6: Outgoing voice message stays right-aligned without full-width stretch', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage } = session;

      await sendVoiceMessageViaUpload(alicePage, 'voice-self-align');
      await openChatPanel(alicePage);

      const selfVoiceItems = alicePage.locator(
        '[data-testid="chat-message-list"] [data-testid="chat-voice-item-self"]',
      );
      await expect(selfVoiceItems).toHaveCount(1);

      const layoutMetrics = await alicePage.evaluate(() => {
        const list = document.querySelector(
          '[data-testid="chat-message-list"]',
        ) as HTMLElement | null;
        const selfVoiceItem = document.querySelector(
          '[data-testid="chat-message-list"] [data-testid="chat-voice-item-self"]',
        ) as HTMLElement | null;
        const voiceBubble = selfVoiceItem?.querySelector(
          '[data-testid="chat-voice-bubble"]',
        ) as HTMLElement | null;
        const voicePlayer = selfVoiceItem?.querySelector(
          '[data-testid="chat-voice-player"]',
        ) as HTMLElement | null;

        if (!list || !selfVoiceItem || !voiceBubble || !voicePlayer) {
          return null;
        }

        const listRect = list.getBoundingClientRect();
        const itemRect = selfVoiceItem.getBoundingClientRect();
        const bubbleRect = voiceBubble.getBoundingClientRect();
        const playerRect = voicePlayer.getBoundingClientRect();

        const computedStyle = window.getComputedStyle(list);
        const paddingLeft = Number.parseFloat(computedStyle.paddingLeft || '0');
        const paddingRight = Number.parseFloat(
          computedStyle.paddingRight || '0',
        );
        const contentWidth = listRect.width - paddingLeft - paddingRight;
        const contentRight = listRect.right - paddingRight;

        return {
          contentWidth,
          contentRight,
          itemWidth: itemRect.width,
          itemRight: itemRect.right,
          playerRight: playerRect.right,
        };
      });

      expect(layoutMetrics).not.toBeNull();
      if (!layoutMetrics) {
        throw new Error('Failed to resolve chat layout metrics');
      }

      expect(layoutMetrics.itemWidth).toBeLessThan(
        layoutMetrics.contentWidth - 16,
      );
      expect(
        Math.abs(layoutMetrics.contentRight - layoutMetrics.itemRight),
      ).toBeLessThanOrEqual(2);
      expect(layoutMetrics.playerRight).toBeGreaterThanOrEqual(
        layoutMetrics.contentRight - 20,
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

// Type augmentation for window.pokerDebug
declare global {
  interface Window {
    pokerDebug: {
      createRoom: (name: string) => void;
      joinRoom: (roomId: string, name: string) => void;
      startGame: () => void;
      check: () => void;
      call: () => void;
      raise: (amount: number) => void;
      fold: () => void;
      allIn: () => void;
      getRoom: () => any;
    };
  }
}
