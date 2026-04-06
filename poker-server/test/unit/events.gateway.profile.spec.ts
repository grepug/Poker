import { EventsGateway } from '../../src/events/events.gateway';

describe('EventsGateway profile update', () => {
  let gateway: EventsGateway;
  let authService: {
    getUserByToken: jest.Mock;
    updateProfileByUserId: jest.Mock;
  };

  beforeEach(() => {
    authService = {
      getUserByToken: jest.fn(),
      updateProfileByUserId: jest.fn(),
    };

    gateway = new EventsGateway(
      {} as any,
      {} as any,
      {} as any,
      { isTestMode: jest.fn().mockReturnValue(false) } as any,
      authService as any,
      {
        getRoom: jest.fn(),
        persistRoom: jest.fn(),
        deleteRoom: jest.fn(),
        getAllRooms: jest.fn(),
        roomExists: jest.fn(),
      } as any,
      {
        getMessagePage: jest.fn(),
        appendMessage: jest.fn(),
        hasChatData: jest.fn(),
        deleteRoomChat: jest.fn(),
        listRoomsWithChatData: jest.fn(),
        pruneRoomMessages: jest.fn(),
      } as any,
      {
        saveVoiceClip: jest.fn(),
        deleteRoomMedia: jest.fn(),
        pruneOrphanMedia: jest.fn(),
      } as any,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      sockets: { sockets: new Map() },
    } as any;
  });

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  it('updates profile for authenticated socket user', async () => {
    authService.getUserByToken.mockResolvedValue({
      id: 'user-1',
      accountId: 'test1',
      displayName: 'test1',
      avatarEmoji: '🧪',
    });
    authService.updateProfileByUserId.mockResolvedValue({
      id: 'user-1',
      accountId: 'test1',
      displayName: 'new-name',
      avatarEmoji: '😎',
    });

    const client = {
      id: 'socket-1',
      emit: jest.fn(),
      handshake: {
        auth: { token: 'token-1' },
        headers: {},
      },
    } as any;

    const response = await gateway.handleUpdateProfile(client, {
      displayName: 'new-name',
      avatarEmoji: '😎',
    });

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        user: expect.objectContaining({
          id: 'user-1',
          displayName: 'new-name',
          avatarEmoji: '😎',
        }),
      }),
    );
    expect(authService.getUserByToken).toHaveBeenCalledWith('token-1');
    expect(authService.updateProfileByUserId).toHaveBeenCalledWith({
      userId: 'user-1',
      displayName: 'new-name',
      avatarEmoji: '😎',
    });
    expect(client.emit).not.toHaveBeenCalledWith('ERROR', expect.anything());
  });

  it('returns error when socket is unauthenticated', async () => {
    const client = {
      id: 'socket-2',
      emit: jest.fn(),
      handshake: {
        auth: {},
        headers: {},
      },
    } as any;

    const response = await gateway.handleUpdateProfile(client, {
      displayName: 'name',
      avatarEmoji: '🙂',
    });

    expect(response).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Authentication required',
      }),
    );
    expect(client.emit).toHaveBeenCalledWith('ERROR', {
      message: 'Authentication required',
    });
  });

  it('authenticates socket user from cookie header when auth payload is absent', async () => {
    authService.getUserByToken.mockResolvedValue({
      id: 'user-1',
      accountId: 'test1',
      displayName: 'test1',
      avatarEmoji: '🧪',
    });
    authService.updateProfileByUserId.mockResolvedValue({
      id: 'user-1',
      accountId: 'test1',
      displayName: 'cookie-user',
      avatarEmoji: '🍪',
    });

    const client = {
      id: 'socket-cookie',
      emit: jest.fn(),
      handshake: {
        auth: {},
        headers: {
          cookie: 'other=value; poker_session=cookie-token',
        },
      },
    } as any;

    const response = await gateway.handleUpdateProfile(client, {
      displayName: 'cookie-user',
      avatarEmoji: '🍪',
    });

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(authService.getUserByToken).toHaveBeenCalledWith('cookie-token');
  });

  it('returns error when profile update fails', async () => {
    authService.getUserByToken.mockResolvedValue({
      id: 'user-1',
      accountId: 'test1',
      displayName: 'test1',
      avatarEmoji: '🧪',
    });
    authService.updateProfileByUserId.mockRejectedValue(
      new Error('Display name is already taken'),
    );

    const client = {
      id: 'socket-3',
      emit: jest.fn(),
      handshake: {
        auth: { token: 'token-1' },
        headers: {},
      },
    } as any;

    const response = await gateway.handleUpdateProfile(client, {
      displayName: 'duplicate',
      avatarEmoji: '🙂',
    });

    expect(response).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Display name is already taken',
      }),
    );
    expect(client.emit).toHaveBeenCalledWith('ERROR', {
      message: 'Display name is already taken',
    });
  });
});
