import { test, expect } from '@playwright/test';
import * as path from 'path';
import {
  buildChipRanking,
  DEFAULT_BIG_BLIND,
  DEFAULT_OPENING_POT,
  DEFAULT_SMALL_BLIND_CALL_GAP,
  E2E_DATA_DIR,
  FRONTEND_URL,
  authenticateTestUser,
  getChatMessagesFromDebug,
  getRoomSnapshot,
  openChatPanel,
  pathExists,
  readJsonFileValue,
  readJsonlFile,
  sendChatMessagesViaSocket,
  sendVoiceMessageViaUpload,
  setupTwoPlayerSession,
  startGameFromLobby,
  teardownTwoPlayerSession,
  waitForPersistedRoomSnapshot,
  waitForPlayerTurn,
  waitForVoicePlaybackSource,
} from './helpers/persistence-e2e.helpers';

async function waitForJsonFileMatch<T>(
  filePath: string,
  predicate: (value: T) => boolean,
  timeoutMs = 10000,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await pathExists(filePath)) {
      const value = await readJsonFileValue<T>(filePath);
      if (predicate(value)) {
        return value;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

test.describe('Poker E2E - Persistence Storage', () => {
  test('1.1: Auth, room, hand, and chat storage use JSONL layouts without legacy files', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;

      const authLogPath = path.join(E2E_DATA_DIR, 'auth', 'auth.jsonl');
      const authStatePath = path.join(E2E_DATA_DIR, 'auth', 'auth.state.json');
      expect(await pathExists(authLogPath)).toBe(true);
      expect(await pathExists(authStatePath)).toBe(true);
      expect(await pathExists(path.join(E2E_DATA_DIR, 'auth', 'users.json'))).toBe(
        false,
      );
      expect(
        await pathExists(path.join(E2E_DATA_DIR, 'auth', 'sessions.json')),
      ).toBe(false);

      const authRecords = await readJsonlFile<any>(authLogPath);
      expect(
        authRecords.some(
          (record) =>
            record.type === 'USER_UPSERTED' &&
            ['test1', 'test2'].includes(record.user?.accountId),
        ),
      ).toBe(true);
      expect(
        authRecords.some((record) => record.type === 'SESSION_UPSERTED'),
      ).toBe(true);

      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.evaluate(() => (window as any).pokerDebug.raise(20));
      await waitForPlayerTurn(alicePage, 'Alice');

      const messageText = 'storage-layout-message';
      await sendChatMessagesViaSocket(alicePage, [messageText], 'layout');
      await bobPage.waitForFunction(
        ({ expectedText }) => {
          const chatMessages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          return chatMessages.some(
            (message: any) =>
              message.kind === 'TEXT' && message.text === expectedText,
          );
        },
        { expectedText: messageText },
        { timeout: 10000 },
      );

      const liveState = await getRoomSnapshot(alicePage);
      const persistedRoom = await waitForPersistedRoomSnapshot(
        roomCode,
        (room) =>
          room.currentHand?.handNumber === liveState.handNumber &&
          room.currentHand?.currentBet === liveState.currentBet &&
          room.currentHand?.pot === liveState.pot,
      );
      expect(persistedRoom.event.seq).toBeGreaterThan(0);

      const roomDir = path.join(E2E_DATA_DIR, 'rooms', roomCode);
      const roomEventsPath = path.join(roomDir, 'room-events.jsonl');
      const roomSnapshotPath = path.join(roomDir, 'room.snapshot.json');
      const handEventsPath = path.join(
        roomDir,
        'hands',
        `${liveState.handNumber}.jsonl`,
      );
      expect(await pathExists(roomEventsPath)).toBe(true);
      expect(await pathExists(roomSnapshotPath)).toBe(true);
      expect(await pathExists(handEventsPath)).toBe(true);
      expect(
        await pathExists(path.join(E2E_DATA_DIR, 'rooms', `${roomCode}.json`)),
      ).toBe(false);

      const roomEvents = await readJsonlFile<any>(roomEventsPath);
      expect(roomEvents.some((record) => record.type === 'HAND_STARTED')).toBe(
        true,
      );
      expect(roomEvents.some((record) => record.type === 'PLAYER_ACTION')).toBe(
        true,
      );
      expect(
        roomEvents.some((record) => record.type === 'ROOM_STATE_UPDATED'),
      ).toBe(true);

      const handEvents = await readJsonlFile<any>(handEventsPath);
      expect(handEvents.some((record) => record.type === 'HAND_STARTED')).toBe(
        true,
      );
      expect(handEvents.some((record) => record.type === 'PLAYER_ACTION')).toBe(
        true,
      );

      const roomProjection = await readJsonFileValue<any>(roomSnapshotPath);
      expect(roomProjection.room?.id).toBe(roomCode);
      expect(roomProjection.room?.currentHand?.pot).toBe(liveState.pot);

      const chatDir = path.join(E2E_DATA_DIR, 'chat', roomCode);
      const chatLogPath = path.join(chatDir, 'messages.jsonl');
      const chatIndexPath = path.join(chatDir, 'chat.index.json');
      expect(await pathExists(chatLogPath)).toBe(true);
      expect(await pathExists(chatIndexPath)).toBe(true);
      expect(
        await pathExists(path.join(E2E_DATA_DIR, 'chat', `${roomCode}.json`)),
      ).toBe(false);

      const chatRecords = await readJsonlFile<any>(chatLogPath);
      expect(
        chatRecords.some(
          (record) =>
            record.type === 'MESSAGE_APPENDED' &&
            record.message?.kind === 'TEXT' &&
            record.message?.text === messageText,
        ),
      ).toBe(true);

      const chatIndex = await readJsonFileValue<any>(chatIndexPath);
      expect(
        chatIndex.latestMessages.some(
          (message: any) =>
            message.kind === 'TEXT' && message.text === messageText,
        ),
      ).toBe(true);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('1.2: Refresh restores chat and pagination can load full history', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const totalMessages = 65;
      const messages = Array.from(
        { length: totalMessages },
        (_, index) => `history-msg-${index}`,
      );

      await sendChatMessagesViaSocket(alicePage, messages, 'history');

      const persistedSessionSnapshot = await bobPage.evaluate(() => ({
        activeSession: window.sessionStorage.getItem('poker.activeSession'),
      }));
      expect(persistedSessionSnapshot.activeSession).toBeTruthy();

      await bobPage.addInitScript((snapshot) => {
        if (snapshot.activeSession) {
          window.sessionStorage.setItem(
            'poker.activeSession',
            snapshot.activeSession,
          );
        }
      }, persistedSessionSnapshot);

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
          await bobPage.fill('[data-testid="name-input"]', 'Bob');
          await bobPage.fill('[data-testid="room-id-input"]', session.roomCode);
          await bobPage.click('[data-testid="join-room-button"]');
        }
      }

      await bobPage.waitForFunction(
        () => {
          const pd = (window as any).pokerDebug;
          return !!pd?.getRoom?.()?.id && !!pd?.getPlayer?.()?.id;
        },
        { timeout: 15000 },
      );

      await openChatPanel(bobPage);

      await bobPage.waitForFunction(
        ({ latestText }) => {
          const chatMessages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          return chatMessages.some(
            (message: any) =>
              message.kind === 'TEXT' && message.text === latestText,
          );
        },
        { latestText: messages[messages.length - 1] },
        { timeout: 10000 },
      );

      const initialCount = (await getChatMessagesFromDebug(bobPage)).length;
      expect(initialCount).toBeLessThan(totalMessages);

      const loadedCount = await bobPage.evaluate(async (expectedCount) => {
        const sleep = (ms: number) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          });

        for (let attempt = 0; attempt < 12; attempt += 1) {
          const currentCount =
            (window as any).pokerDebug?.getChatMessages?.()?.length ?? 0;
          if (currentCount >= expectedCount) {
            return currentCount;
          }
          (window as any).pokerDebug?.loadOlderChatMessages?.();
          await sleep(150);
        }

        return (window as any).pokerDebug?.getChatMessages?.()?.length ?? 0;
      }, totalMessages);

      expect(loadedCount).toBeGreaterThanOrEqual(totalMessages);

      const hasEndpoints = await bobPage.evaluate(
        ({ firstText, lastText }) => {
          const chatMessages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          const textMessages = chatMessages
            .filter((message: any) => message.kind === 'TEXT')
            .map((message: any) => message.text);
          return {
            hasFirst: textMessages.includes(firstText),
            hasLast: textMessages.includes(lastText),
          };
        },
        {
          firstText: messages[0],
          lastText: messages[messages.length - 1],
        },
      );

      expect(hasEndpoints.hasFirst).toBe(true);
      expect(hasEndpoints.hasLast).toBe(true);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('1.3: JSONL ledgers append auth, room, and chat records without legacy files', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, roomCode } = session;
      const messages = ['ledger-msg-1', 'ledger-msg-2', 'ledger-msg-3'];

      await sendChatMessagesViaSocket(alicePage, messages, 'ledger');

      const authStatePath = path.join(E2E_DATA_DIR, 'auth', 'auth.state.json');
      const authState = await waitForJsonFileMatch<any>(
        authStatePath,
        (state) =>
          state.users?.some(
            (user: any) =>
              user.accountId === 'test1' && user.displayName === 'Alice',
          ) &&
          state.users?.some(
            (user: any) =>
              user.accountId === 'test2' && user.displayName === 'Bob',
          ) &&
          Array.isArray(state.sessions) &&
          state.sessions.length >= 2,
      );

      const authLogPath = path.join(E2E_DATA_DIR, 'auth', 'auth.jsonl');
      const roomEventsPath = path.join(
        E2E_DATA_DIR,
        'rooms',
        roomCode,
        'room-events.jsonl',
      );
      const chatLogPath = path.join(
        E2E_DATA_DIR,
        'chat',
        roomCode,
        'messages.jsonl',
      );

      const authLog = await readJsonlFile<any>(authLogPath);
      const roomLog = await readJsonlFile<any>(roomEventsPath);
      const chatLog = await readJsonlFile<any>(chatLogPath);

      expect(
        authLog.some(
          (record) =>
            record.type === 'USER_UPSERTED' &&
            record.user?.accountId === 'test1' &&
            record.user?.displayName === 'Alice',
        ),
      ).toBe(true);
      expect(
        authLog.some(
          (record) =>
            record.type === 'USER_UPSERTED' &&
            record.user?.accountId === 'test2' &&
            record.user?.displayName === 'Bob',
        ),
      ).toBe(true);
      expect(
        authLog.some((record) => record.type === 'SESSION_UPSERTED'),
      ).toBe(true);
      expect(authState.sessions.length).toBeGreaterThanOrEqual(2);

      expect(roomLog.some((record) => record.type === 'ROOM_CREATED')).toBe(
        true,
      );
      expect(roomLog.some((record) => record.type === 'PLAYER_JOINED')).toBe(
        true,
      );
      expect(
        roomLog.some((record) => record.type === 'ROOM_STATE_UPDATED'),
      ).toBe(true);

      const appendedTexts = chatLog
        .filter((record) => record.type === 'MESSAGE_APPENDED')
        .map((record) =>
          record.message?.kind === 'TEXT' ? record.message.text : null,
        )
        .filter((text): text is string => Boolean(text));
      expect(appendedTexts).toEqual(expect.arrayContaining(messages));

      expect(await pathExists(path.join(E2E_DATA_DIR, 'auth', 'users.json'))).toBe(
        false,
      );
      expect(
        await pathExists(path.join(E2E_DATA_DIR, 'auth', 'sessions.json')),
      ).toBe(false);
      expect(
        await pathExists(path.join(E2E_DATA_DIR, 'rooms', `${roomCode}.json`)),
      ).toBe(false);
      expect(
        await pathExists(path.join(E2E_DATA_DIR, 'chat', `${roomCode}.json`)),
      ).toBe(false);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('1.4: Chat JSONL ledger stays sequential and chat index tracks appended history', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;
      const messages = Array.from(
        { length: 6 },
        (_, index) => `index-msg-${index}`,
      );

      await sendChatMessagesViaSocket(alicePage, messages, 'index');
      await bobPage.waitForFunction(
        ({ latestText }) => {
          const chatMessages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          return chatMessages.some(
            (message: any) =>
              message.kind === 'TEXT' && message.text === latestText,
          );
        },
        { latestText: messages[messages.length - 1] },
        { timeout: 10000 },
      );

      const chatLogPath = path.join(
        E2E_DATA_DIR,
        'chat',
        roomCode,
        'messages.jsonl',
      );
      const chatLog = await readJsonlFile<any>(chatLogPath);
      const appendedRecords = chatLog.filter(
        (record) => record.type === 'MESSAGE_APPENDED',
      );
      const appendedTexts = appendedRecords
        .map((record: any) =>
          record.message?.kind === 'TEXT' ? record.message.text : null,
        )
        .filter((text: string | null): text is string => Boolean(text));
      const appendedSeqs = appendedRecords.map(
        (record: any) => record.message?.seq,
      );

      expect(appendedTexts.slice(-messages.length)).toEqual(messages);
      expect(appendedSeqs).toEqual(
        [...appendedSeqs].sort((left, right) => left - right),
      );

      const chatIndexPath = path.join(
        E2E_DATA_DIR,
        'chat',
        roomCode,
        'chat.index.json',
      );
      const chatIndex = await waitForJsonFileMatch<any>(
        chatIndexPath,
        (index) =>
          index.latestMessages?.some(
            (message: any) =>
              message.kind === 'TEXT' &&
              message.text === messages[messages.length - 1],
          ),
      );

      const latestTexts = (chatIndex.latestMessages ?? [])
        .map((message: any) =>
          message.kind === 'TEXT' ? message.text : null,
        )
        .filter((text: string | null): text is string => Boolean(text));
      expect(latestTexts.slice(-messages.length)).toEqual(messages);

      const lastIndexedMessage =
        chatIndex.latestMessages?.[chatIndex.latestMessages.length - 1];
      expect(chatIndex.nextSeq).toBe((lastIndexedMessage?.seq ?? 0) + 1);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('1.5: Persisted room snapshots can reconstruct a point-in-time table state', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(50));
      await waitForPlayerTurn(alicePage, 'Alice');

      const liveState = await getRoomSnapshot(alicePage);
      expect(liveState.bettingRound).toBe('PRE_FLOP');
      expect(liveState.currentPlayerName).toBe('Alice');
      expect(liveState.pot).toBeGreaterThan(DEFAULT_OPENING_POT);
      expect(liveState.currentBet).toBeGreaterThan(DEFAULT_BIG_BLIND);

      const persisted = await waitForPersistedRoomSnapshot(
        roomCode,
        (room) => {
          const hand = room.currentHand;
          const alice = room.players.find((player) => player.name === 'Alice');
          const bob = room.players.find((player) => player.name === 'Bob');

          return (
            hand?.handNumber === liveState.handNumber &&
            hand?.bettingRound === liveState.bettingRound &&
            hand?.pot === liveState.pot &&
            hand?.currentBet === liveState.currentBet &&
            hand?.currentPlayerTurn === liveState.currentPlayerTurn &&
            alice?.chips === liveState.aliceChips &&
            bob?.chips === liveState.bobChips &&
            alice?.currentBet === liveState.aliceCurrentBet &&
            bob?.currentBet === liveState.bobCurrentBet
          );
        },
        10000,
      );

      expect(persisted.event.seq).toBeGreaterThan(0);
      expect(persisted.room.currentHand?.bettingRound).toBe('PRE_FLOP');
      expect(persisted.room.currentHand?.pot).toBe(liveState.pot);
      expect(persisted.room.currentHand?.currentBet).toBe(liveState.currentBet);
      expect(persisted.room.currentHand?.currentPlayerTurn).toBe(
        liveState.currentPlayerTurn,
      );

      const persistedRanking = buildChipRanking(persisted.room);
      expect(persistedRanking.slice(0, 2)).toEqual([
        expect.objectContaining({ name: 'Alice', chips: liveState.aliceChips }),
        expect.objectContaining({ name: 'Bob', chips: liveState.bobChips }),
      ]);

      expect(persisted.previousSemanticEvent?.type).toBe('PLAYER_ACTION');
      expect(persisted.previousSemanticEvent?.handNumber).toBe(
        liveState.handNumber,
      );
      expect(persisted.previousSemanticEvent?.street).toBe('PRE_FLOP');
      expect(
        (persisted.previousSemanticEvent?.payload as any)?.request,
      ).toEqual(
        expect.objectContaining({
          action: 'raise',
          amount: 50,
        }),
      );
      expect(
        (persisted.previousSemanticEvent?.payload as any)?.result,
      ).toEqual(
        expect.objectContaining({
          resolvedAction: 'raise',
          totalBetAfterAction: liveState.currentBet,
          committedAmount: liveState.pot - DEFAULT_OPENING_POT,
          currentBetAfter: liveState.currentBet,
          potAfter: liveState.pot,
        }),
      );
      expect(
        (persisted.previousSemanticEvent?.payload as any)?.decision,
      ).toEqual(
        expect.objectContaining({
          currentBetBefore: DEFAULT_BIG_BLIND,
          callAmountBefore: DEFAULT_SMALL_BLIND_CALL_GAP,
          minimumRaiseBy: DEFAULT_BIG_BLIND,
          minimumRaiseTo: DEFAULT_BIG_BLIND * 2,
          facingBet: true,
        }),
      );
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('1.6: Voice upload message persists and is playable after sync', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;

      const uploaded = await sendVoiceMessageViaUpload(alicePage, 'voice');
      const expectedVoiceUrl = `${uploaded.serverBaseUrl}${uploaded.voice.audioUrl}`;

      await bobPage.waitForFunction(
        ({ expectedAudioUrl }) => {
          const chatMessages =
            (window as any).pokerDebug?.getChatMessages?.() ?? [];
          return chatMessages.some(
            (message: any) =>
              message.kind === 'VOICE' &&
              message.voice?.audioUrl === expectedAudioUrl,
          );
        },
        { expectedAudioUrl: uploaded.voice.audioUrl },
        { timeout: 10000 },
      );

      await openChatPanel(bobPage);

      const voicePlayers = bobPage.locator(
        '[data-testid="chat-message-list"] [data-testid="chat-voice-player"]',
      );
      await expect(voicePlayers.first()).toBeVisible();
      await expect(voicePlayers.first()).toContainText(/\d+'/);

      await voicePlayers.first().click();
      await waitForVoicePlaybackSource(bobPage, expectedVoiceUrl);

      const mediaResponse = await bobPage.request.get(expectedVoiceUrl);
      expect(mediaResponse.ok()).toBe(true);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});
