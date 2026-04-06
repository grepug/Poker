import { mkdtemp, rm, unlink } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { JsonChatStorageService } from '../../src/storage/json-chat-storage.service';

describe('JsonChatStorageService', () => {
  let service: JsonChatStorageService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'poker-chat-storage-'));

    const configService = {
      get: (key: string) => {
        if (key === 'DATA_DIR') return tempDir;
        if (key === 'CHAT_PAGE_SIZE') return '50';
        if (key === 'CHAT_PAGE_MAX_SIZE') return '200';
        if (key === 'CHAT_DEDUPE_WINDOW_MS') return '600000';
        return undefined;
      },
    } as any;

    service = new JsonChatStorageService(configService);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('appends messages with monotonic sequence under concurrency', async () => {
    const roomId = 'ROOM123';

    await Promise.all(
      Array.from({ length: 12 }).map((_, index) =>
        service.appendMessage({
          roomId,
          kind: 'TEXT',
          text: `message-${index}`,
          clientMessageId: `client-${index}`,
          sender: {
            playerId: 'player-a',
            playerName: 'Alice',
          },
        }),
      ),
    );

    const page = await service.getMessagePage(roomId, { limit: 200 });
    expect(page.messages).toHaveLength(12);
    expect(page.messages.map((message) => message.seq)).toEqual(
      Array.from({ length: 12 }).map((_, index) => index + 1),
    );
    expect(page.hasMore).toBe(false);
  });

  it('deduplicates by clientMessageId within dedupe window', async () => {
    const roomId = 'ROOMDUP';
    const first = await service.appendMessage({
      roomId,
      kind: 'TEXT',
      text: 'hello',
      clientMessageId: 'same-id',
      sender: {
        playerId: 'p1',
        playerName: 'Alice',
      },
    });

    const second = await service.appendMessage({
      roomId,
      kind: 'TEXT',
      text: 'hello-again',
      clientMessageId: 'same-id',
      sender: {
        playerId: 'p1',
        playerName: 'Alice',
      },
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);

    const page = await service.getMessagePage(roomId, { limit: 200 });
    expect(page.messages).toHaveLength(1);
  });

  it('supports paginated history with hasMore + nextBeforeSeq', async () => {
    const roomId = 'ROOMPAGE';

    for (let index = 0; index < 8; index += 1) {
      await service.appendMessage({
        roomId,
        kind: 'TEXT',
        text: `message-${index}`,
        clientMessageId: `page-${index}`,
        sender: {
          playerId: 'p1',
          playerName: 'Alice',
        },
      });
    }

    const latestPage = await service.getMessagePage(roomId, { limit: 3 });
    expect(latestPage.messages.map((message) => message.seq)).toEqual([6, 7, 8]);
    expect(latestPage.hasMore).toBe(true);
    expect(latestPage.nextBeforeSeq).toBe(6);

    const previousPage = await service.getMessagePage(roomId, {
      beforeSeq: latestPage.nextBeforeSeq ?? undefined,
      limit: 3,
    });
    expect(previousPage.messages.map((message) => message.seq)).toEqual([3, 4, 5]);
    expect(previousPage.hasMore).toBe(true);
    expect(previousPage.nextBeforeSeq).toBe(3);
  });

  it('rebuilds the bounded chat projection from the log when the index is missing', async () => {
    const roomId = 'ROOM-REBUILD';

    for (let index = 0; index < 3; index += 1) {
      await service.appendMessage(
        {
          roomId,
          kind: 'TEXT',
          text: `message-${index}`,
          clientMessageId: `bounded-${index}`,
          sender: {
            playerId: 'p1',
            playerName: 'Alice',
          },
        },
        { maxMessages: 2 },
      );
    }

    await unlink(path.join(tempDir, 'chat', roomId, 'chat.index.json'));

    const rebuilt = await service.getMessagePage(roomId, { limit: 50 });
    expect(rebuilt.messages.map((message) => message.seq)).toEqual([2, 3]);
    expect(rebuilt.hasMore).toBe(false);
  });

  it('continues room write queue after a failed task', async () => {
    const runRoomWriteSequentially = (service as any)
      .runRoomWriteSequentially.bind(service) as <T>(
      roomId: string,
      task: () => Promise<T>,
    ) => Promise<T>;

    await expect(
      runRoomWriteSequentially('ROOM-QUEUE', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(
      runRoomWriteSequentially('ROOM-QUEUE', async () => 'ok'),
    ).resolves.toBe('ok');
  });

});
