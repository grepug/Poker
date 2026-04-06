import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'crypto';
import type {
  AuthSessionRecord,
  AuthUserRecord,
  IAuthStorageService,
} from '../common/interfaces/auth-storage.interface';
import type { IStorageService } from '../common/interfaces/storage.interface';
import { realtimeEventBus } from '../common/realtime-events';
import { roomEvent, roomWrite } from '../storage/room-write.factory';

type FlowKind = 'passkey-register' | 'passkey-login';

type PendingFlow = {
  flowId: string;
  kind: FlowKind;
  challenge: string;
  expiresAt: number;
  draftUser?: {
    id: string;
    accountId: string;
    displayName: string;
    avatarEmoji: string;
  };
};

export type PublicAuthUser = {
  id: string;
  accountId: string;
  displayName: string;
  avatarEmoji: string;
  hasPassword: boolean;
  passkeyCount: number;
  createdAt: number;
  updatedAt: number;
};

type SessionUser = {
  user: AuthUserRecord;
  session: AuthSessionRecord;
};

const FLOW_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WEBAUTHN_RP_ID = 'localhost';
const DEFAULT_WEBAUTHN_ORIGIN = 'http://localhost:5173';
const LOCALHOST_RP_IDS = new Set(['localhost', '127.0.0.1', '::1']);

type WebauthnDomainConfig = {
  rpId: string;
  expectedOrigins: string[];
};

const parseOriginList = (input: string | undefined): string[] => {
  if (!input) {
    return [];
  }
  return input
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const parseAuthDomain = (
  authDomain: string | undefined,
): { rpId: string; origin: string } | null => {
  const raw = authDomain?.trim();
  if (!raw) {
    return null;
  }

  const hasScheme = /^https?:\/\//i.test(raw);
  try {
    const preliminary = hasScheme ? new URL(raw) : new URL(`http://${raw}`);
    const protocol = hasScheme
      ? preliminary.protocol
      : LOCALHOST_RP_IDS.has(preliminary.hostname)
        ? 'http:'
        : 'https:';
    const normalized = new URL(preliminary.toString());
    normalized.protocol = protocol;
    normalized.pathname = '/';
    normalized.search = '';
    normalized.hash = '';

    return {
      rpId: normalized.hostname,
      origin: normalized.origin,
    };
  } catch {
    return null;
  }
};

const resolveWebauthnDomainConfig = (): WebauthnDomainConfig => {
  const explicitRpId = process.env.WEBAUTHN_RP_ID?.trim();
  const explicitOrigins = parseOriginList(process.env.WEBAUTHN_ORIGIN);
  const authDomain = parseAuthDomain(process.env.AUTH_DOMAIN);

  return {
    rpId: explicitRpId || authDomain?.rpId || DEFAULT_WEBAUTHN_RP_ID,
    expectedOrigins:
      explicitOrigins.length > 0
        ? explicitOrigins
        : authDomain?.origin
          ? [authDomain.origin]
          : [DEFAULT_WEBAUTHN_ORIGIN],
  };
};

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly flows = new Map<string, PendingFlow>();
  private readonly flowCleanupIntervalMs = Number(
    process.env.AUTH_FLOW_CLEANUP_INTERVAL_MS || `${60 * 1000}`,
  );
  private readonly maxPendingFlows = Number(
    process.env.AUTH_MAX_PENDING_FLOWS || '1000',
  );
  private readonly authRateWindows = new Map<
    string,
    { timestamps: number[]; windowMs: number }
  >();
  private readonly maxAuthRateWindows = Number(
    process.env.AUTH_RATE_LIMIT_MAX_WINDOWS || '5000',
  );
  private readonly passkeyRegisterStartRateLimitCount = Number(
    process.env.AUTH_PASSKEY_REGISTER_START_RATE_LIMIT_COUNT || '20',
  );
  private readonly passkeyRegisterStartRateLimitWindowMs = Number(
    process.env.AUTH_PASSKEY_REGISTER_START_RATE_LIMIT_WINDOW_MS ||
      `${10 * 60 * 1000}`,
  );
  private readonly passkeyLoginStartRateLimitCount = Number(
    process.env.AUTH_PASSKEY_LOGIN_START_RATE_LIMIT_COUNT || '30',
  );
  private readonly passkeyLoginStartRateLimitWindowMs = Number(
    process.env.AUTH_PASSKEY_LOGIN_START_RATE_LIMIT_WINDOW_MS ||
      `${10 * 60 * 1000}`,
  );
  private readonly passwordLoginRateLimitCount = Number(
    process.env.AUTH_PASSWORD_LOGIN_RATE_LIMIT_COUNT || '10',
  );
  private readonly passwordLoginRateLimitWindowMs = Number(
    process.env.AUTH_PASSWORD_LOGIN_RATE_LIMIT_WINDOW_MS || `${10 * 60 * 1000}`,
  );
  private readonly sessionTtlMs = 365 * 24 * 60 * 60 * 1000;
  private readonly passwordLoginEnabled =
    process.env.AUTH_PASSWORD_LOGIN_ENABLED?.trim() === 'true' ||
    process.env.NODE_ENV !== 'production';
  private readonly rpName =
    process.env.WEBAUTHN_RP_NAME?.trim() || 'Poker Game';
  private readonly webauthnDomainConfig = resolveWebauthnDomainConfig();
  private readonly rpId = this.webauthnDomainConfig.rpId;
  private readonly expectedOrigins = this.webauthnDomainConfig.expectedOrigins;
  private flowCleanupTimer: NodeJS.Timeout | null = null;
  private userMutationQueue: Promise<void> = Promise.resolve();
  private sessionMutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @Inject('IAuthStorageService')
    private readonly authStorageService: IAuthStorageService,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeededPasswordUsers();
    this.flowCleanupTimer = setInterval(() => {
      this.cleanupExpiredFlows();
    }, this.flowCleanupIntervalMs);
    this.flowCleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.flowCleanupTimer) {
      clearInterval(this.flowCleanupTimer);
      this.flowCleanupTimer = null;
    }
    this.authRateWindows.clear();
  }

  getAuthModes() {
    return {
      passkey: true,
      password: this.passwordLoginEnabled,
    };
  }

  async startPasskeyRegistration(input: {
    displayName: string;
    avatarEmoji: string;
    rateLimitKey?: string;
  }): Promise<{ flowId: string; options: unknown }> {
    this.assertAuthRateLimit(
      'passkey-register-start',
      input.rateLimitKey,
      this.passkeyRegisterStartRateLimitCount,
      this.passkeyRegisterStartRateLimitWindowMs,
    );
    const displayName = this.normalizeDisplayName(input.displayName);
    const avatarEmoji = this.normalizeAvatarEmoji(input.avatarEmoji);
    const users = await this.authStorageService.getUsers();
    this.assertDisplayNameAvailable(displayName, users);

    const draftUser = {
      id: randomUUID(),
      accountId: this.generateUniquePasskeyAccountId(users),
      displayName,
      avatarEmoji,
    };

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: draftUser.accountId,
      userDisplayName: draftUser.displayName,
      userID: new TextEncoder().encode(draftUser.id),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      attestationType: 'none',
    });

    this.cleanupExpiredFlows();
    this.ensureFlowCapacity();
    const flowId = randomUUID();
    this.flows.set(flowId, {
      flowId,
      kind: 'passkey-register',
      challenge: options.challenge,
      expiresAt: Date.now() + FLOW_TTL_MS,
      draftUser,
    });

    return { flowId, options };
  }

  async finishPasskeyRegistration(input: {
    flowId: string;
    response: unknown;
  }): Promise<{
    sessionToken: string;
    sessionExpiresAt: number;
    user: PublicAuthUser;
  }> {
    const flow = this.consumeFlow(input.flowId, 'passkey-register');
    const draftUser = flow.draftUser;
    if (!draftUser) {
      throw new BadRequestException('Invalid registration flow');
    }

    const verification = await verifyRegistrationResponse({
      response: input.response as any,
      expectedChallenge: flow.challenge,
      expectedOrigin:
        this.expectedOrigins.length === 1
          ? this.expectedOrigins[0]
          : this.expectedOrigins,
      expectedRPID: this.rpId,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException(
        'Passkey registration verification failed',
      );
    }

    const registrationInfo: any = verification.registrationInfo;
    const credentialId: string =
      registrationInfo.credential?.id ||
      Buffer.from(registrationInfo.credentialID).toString('base64url');
    const publicKey: string = registrationInfo.credential?.publicKey
      ? Buffer.from(registrationInfo.credential.publicKey).toString('base64url')
      : Buffer.from(registrationInfo.credentialPublicKey).toString('base64url');
    const counter: number =
      registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0;
    const transports: string[] | undefined = Array.isArray(
      registrationInfo.credential?.transports,
    )
      ? registrationInfo.credential.transports
      : undefined;

    const user = await this.runUserMutation(async () => {
      const users = await this.authStorageService.getUsers();
      this.assertDisplayNameAvailable(draftUser.displayName, users);
      const credentialAlreadyUsed = users.some((entry) =>
        entry.passkeys.some((passkey) => passkey.credentialId === credentialId),
      );
      if (credentialAlreadyUsed) {
        throw new BadRequestException('Passkey is already registered');
      }

      const now = Date.now();
      const accountIdInUse = users.some(
        (entry) => entry.accountId === draftUser.accountId,
      );
      const accountId = accountIdInUse
        ? this.generateUniquePasskeyAccountId(users)
        : draftUser.accountId;
      const nextUser: AuthUserRecord = {
        id: draftUser.id,
        accountId,
        displayName: draftUser.displayName,
        avatarEmoji: draftUser.avatarEmoji,
        passkeys: [
          {
            credentialId,
            publicKey,
            counter,
            transports,
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      users.push(nextUser);
      await this.authStorageService.replaceUsers(users);
      return nextUser;
    });

    const session = await this.createSessionForUser(user.id);
    return {
      sessionToken: session.token,
      sessionExpiresAt: session.record.expiresAt,
      user: this.toPublicUser(user),
    };
  }

  async startPasskeyLogin(input?: {
    rateLimitKey?: string;
  }): Promise<{ flowId: string; options: unknown }> {
    this.assertAuthRateLimit(
      'passkey-login-start',
      input?.rateLimitKey,
      this.passkeyLoginStartRateLimitCount,
      this.passkeyLoginStartRateLimitWindowMs,
    );
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'required',
    });

    this.cleanupExpiredFlows();
    this.ensureFlowCapacity();
    const flowId = randomUUID();
    this.flows.set(flowId, {
      flowId,
      kind: 'passkey-login',
      challenge: options.challenge,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });

    return { flowId, options };
  }

  async finishPasskeyLogin(input: {
    flowId: string;
    response: unknown;
  }): Promise<{
    sessionToken: string;
    sessionExpiresAt: number;
    user: PublicAuthUser;
  }> {
    const flow = this.consumeFlow(input.flowId, 'passkey-login');
    const response: any = input.response;
    const credentialId: string = response?.id;
    if (!credentialId) {
      throw new BadRequestException('Missing credential id');
    }

    const users = await this.authStorageService.getUsers();
    const user = users.find((candidate) =>
      candidate.passkeys.some(
        (passkey) => passkey.credentialId === credentialId,
      ),
    );

    if (!user) {
      throw new UnauthorizedException('Passkey not registered');
    }

    const passkey = user.passkeys.find(
      (entry) => entry.credentialId === credentialId,
    );
    if (!passkey) {
      throw new UnauthorizedException('Passkey not found');
    }

    const verification = await verifyAuthenticationResponse({
      response: response as any,
      expectedChallenge: flow.challenge,
      expectedOrigin:
        this.expectedOrigins.length === 1
          ? this.expectedOrigins[0]
          : this.expectedOrigins,
      expectedRPID: this.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
    });

    if (!verification.verified) {
      throw new UnauthorizedException('Passkey verification failed');
    }

    const authenticationInfo: any = verification.authenticationInfo;
    if (typeof authenticationInfo?.newCounter === 'number') {
      const newCounter = authenticationInfo.newCounter;
      await this.runUserMutation(async () => {
        const latestUsers = await this.authStorageService.getUsers();
        const latestUser = latestUsers.find(
          (candidate) => candidate.id === user.id,
        );
        if (!latestUser) {
          return;
        }

        const latestPasskey = latestUser.passkeys.find(
          (entry) => entry.credentialId === credentialId,
        );
        if (!latestPasskey) {
          return;
        }

        const storedCounter =
          typeof latestPasskey.counter === 'number' ? latestPasskey.counter : 0;
        latestPasskey.counter = Math.max(storedCounter, newCounter);
        latestPasskey.updatedAt = Date.now();
        await this.authStorageService.replaceUsers(latestUsers);
      });
    }

    const session = await this.createSessionForUser(user.id);
    return {
      sessionToken: session.token,
      sessionExpiresAt: session.record.expiresAt,
      user: this.toPublicUser(user),
    };
  }

  async loginWithPassword(input: {
    accountId: string;
    password: string;
    rateLimitKey?: string;
  }): Promise<{
    sessionToken: string;
    sessionExpiresAt: number;
    user: PublicAuthUser;
  }> {
    if (!this.passwordLoginEnabled) {
      throw new ForbiddenException('Password login is disabled');
    }

    const accountId = input.accountId.trim();
    if (!accountId) {
      throw new BadRequestException('Account is required');
    }
    const rateLimitPrincipal = `${
      this.normalizeRateLimitKey(input.rateLimitKey) || 'unknown'
    }:${accountId.toLowerCase()}`;
    this.assertAuthRateLimit(
      'password-login',
      rateLimitPrincipal,
      this.passwordLoginRateLimitCount,
      this.passwordLoginRateLimitWindowMs,
    );

    const users = await this.authStorageService.getUsers();
    const user = users.find((entry) => entry.accountId === accountId);
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid account or password');
    }

    const password = input.password || '';
    if (!this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid account or password');
    }

    const session = await this.createSessionForUser(user.id);
    return {
      sessionToken: session.token,
      sessionExpiresAt: session.record.expiresAt,
      user: this.toPublicUser(user),
    };
  }

  async getCurrentSession(token: string): Promise<{
    user: PublicAuthUser;
    sessionExpiresAt: number;
  } | null> {
    const sessionUser = await this.resolveSessionUser(token, true);
    if (!sessionUser) {
      return null;
    }

    return {
      user: this.toPublicUser(sessionUser.user),
      sessionExpiresAt: sessionUser.session.expiresAt,
    };
  }

  async getUserByToken(token: string): Promise<PublicAuthUser | null> {
    const sessionUser = await this.resolveSessionUser(token, true);
    if (!sessionUser) {
      return null;
    }

    return this.toPublicUser(sessionUser.user);
  }

  async logout(token: string): Promise<void> {
    await this.runSessionMutation(async () => {
      const normalizedToken = token.trim();
      if (!normalizedToken) {
        return;
      }

      const tokenHash = this.hashToken(normalizedToken);
      const sessions = await this.authStorageService.getSessions();
      const nextSessions = sessions.filter(
        (session) => session.tokenHash !== tokenHash,
      );
      if (nextSessions.length !== sessions.length) {
        await this.authStorageService.replaceSessions(nextSessions);
      }
    });
  }

  async updateProfileByToken(input: {
    token: string;
    displayName: string;
    avatarEmoji: string;
  }): Promise<PublicAuthUser> {
    const sessionUser = await this.resolveSessionUser(input.token, true);
    if (!sessionUser) {
      throw new UnauthorizedException('Invalid session');
    }

    return this.updateProfileByUserId({
      userId: sessionUser.user.id,
      displayName: input.displayName,
      avatarEmoji: input.avatarEmoji,
    });
  }

  async updateProfileByUserId(input: {
    userId: string;
    displayName: string;
    avatarEmoji: string;
  }): Promise<PublicAuthUser> {
    const displayName = this.normalizeDisplayName(input.displayName);
    const avatarEmoji = this.normalizeAvatarEmoji(input.avatarEmoji);
    const user = await this.runUserMutation(async () => {
      const users = await this.authStorageService.getUsers();
      const foundUser = users.find((entry) => entry.id === input.userId);

      if (!foundUser) {
        throw new UnauthorizedException('User not found');
      }

      const duplicated = users.find(
        (entry) =>
          entry.displayName === displayName && entry.id !== input.userId,
      );
      if (duplicated) {
        throw new BadRequestException('Display name is already taken');
      }

      foundUser.displayName = displayName;
      foundUser.avatarEmoji = avatarEmoji;
      foundUser.updatedAt = Date.now();
      await this.authStorageService.replaceUsers(users);
      return foundUser;
    });
    await this.applyProfileToRooms(user);
    return this.toPublicUser(user);
  }

  private async applyProfileToRooms(user: AuthUserRecord): Promise<void> {
    const rooms = await this.storageService.getAllRooms();
    const now = Date.now();
    const changedRooms = rooms
      .map((room) => {
        const pendingEvents: {
          roomId: string;
          playerId: string;
          playerName: string;
          playerEmoji: string;
        }[] = [];
        let changed = false;
        room.players.forEach(
          (player: {
            id: string;
            userId?: string;
            name: string;
            emoji?: string;
          }) => {
            if (player.userId === user.id) {
              player.name = user.displayName;
              player.emoji = user.avatarEmoji;
              changed = true;
              pendingEvents.push({
                roomId: room.id,
                playerId: player.id,
                playerName: user.displayName,
                playerEmoji: user.avatarEmoji,
              });
            }
          },
        );
        if (!changed) {
          return null;
        }
        room.lastActivityAt = now;
        return { room, pendingEvents };
      })
      .filter(
        (
          entry,
        ): entry is {
          room: Awaited<ReturnType<IStorageService['getAllRooms']>>[number];
          pendingEvents: {
            roomId: string;
            playerId: string;
            playerName: string;
            playerEmoji: string;
          }[];
        } => Boolean(entry),
      );

    const allPendingEvents: {
      roomId: string;
      playerId: string;
      playerName: string;
      playerEmoji: string;
    }[] = [];

    for (const { room, pendingEvents } of changedRooms) {
      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'PLAYER_PROFILE_SYNCED',
            actor: {
              source: 'AUTH',
              userId: user.id,
            },
            payload: {
              userId: user.id,
              displayName: user.displayName,
              avatarEmoji: user.avatarEmoji,
              affectedPlayerIds: pendingEvents.map((event) => event.playerId),
            },
          }),
        ),
      );
      allPendingEvents.push(...pendingEvents);
    }

    allPendingEvents.forEach((eventPayload) => {
      realtimeEventBus.emitEvent('PLAYER_PROFILE_UPDATED', {
        roomId: eventPayload.roomId,
        playerId: eventPayload.playerId,
        playerName: eventPayload.playerName,
        playerEmoji: eventPayload.playerEmoji,
      });
    });
  }

  private async ensureSeededPasswordUsers(): Promise<void> {
    if (!this.passwordLoginEnabled) {
      return;
    }

    await this.runUserMutation(async () => {
      const users = await this.authStorageService.getUsers();
      const now = Date.now();
      const seeds = [
        { accountId: 'test1', displayName: 'test1', avatarEmoji: '🧪' },
        { accountId: 'test2', displayName: 'test2', avatarEmoji: '🛠️' },
        { accountId: 'test3', displayName: 'test3', avatarEmoji: '🎯' },
      ];

      let changed = false;
      for (const seed of seeds) {
        if (users.some((user) => user.accountId === seed.accountId)) {
          continue;
        }

        const user: AuthUserRecord = {
          id: randomUUID(),
          accountId: seed.accountId,
          displayName: seed.displayName,
          avatarEmoji: seed.avatarEmoji,
          passwordHash: this.hashPassword('test1234'),
          passkeys: [],
          createdAt: now,
          updatedAt: now,
        };

        users.push(user);
        changed = true;
      }

      if (changed) {
        await this.authStorageService.replaceUsers(users);
      }
    });
  }

  private toPublicUser(user: AuthUserRecord): PublicAuthUser {
    return {
      id: user.id,
      accountId: user.accountId,
      displayName: user.displayName,
      avatarEmoji: user.avatarEmoji,
      hasPassword: Boolean(user.passwordHash),
      passkeyCount: user.passkeys.length,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private normalizeDisplayName(raw: string): string {
    const value = (raw || '').trim();
    if (!value) {
      throw new BadRequestException('Display name is required');
    }
    return value;
  }

  private normalizeAvatarEmoji(raw: string): string {
    const value = (raw || '').trim();
    if (!value) {
      throw new BadRequestException('Avatar emoji is required');
    }
    return value;
  }

  private assertDisplayNameAvailable(
    displayName: string,
    users: AuthUserRecord[],
  ): void {
    if (users.some((user) => user.displayName === displayName)) {
      throw new BadRequestException('Display name is already taken');
    }
  }

  private generateUniquePasskeyAccountId(users: AuthUserRecord[]): string {
    const existing = new Set(users.map((user) => user.accountId));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = `pk_${randomBytes(4).toString('hex')}`;
      if (!existing.has(candidate)) {
        return candidate;
      }
    }
    return `pk_${Date.now().toString(36)}`;
  }

  private normalizeRateLimitKey(raw?: string): string | null {
    const value = raw?.trim() || '';
    return value || null;
  }

  private assertAuthRateLimit(
    scope: string,
    rawKey: string | undefined,
    limit: number,
    windowMs: number,
  ): void {
    if (process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'test') {
      return;
    }

    const key = this.normalizeRateLimitKey(rawKey);
    if (!key || limit <= 0 || windowMs <= 0) {
      return;
    }

    const now = Date.now();
    const windowKey = `${scope}:${key}`;
    const existing = this.authRateWindows.get(windowKey);
    const recent = (existing?.timestamps || []).filter(
      (timestamp) => timestamp > now - windowMs,
    );

    if (recent.length >= limit) {
      throw new HttpException(
        'Too many requests, please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.authRateWindows.set(windowKey, { timestamps: recent, windowMs });
    this.enforceAuthRateWindowCapacity();
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  private verifyPassword(password: string, encodedHash: string): boolean {
    const [algorithm, salt, hash] = encodedHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !hash) {
      return false;
    }

    const computed = scryptSync(password, salt, 64).toString('hex');
    const hashBuffer = Buffer.from(hash, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');
    if (hashBuffer.length !== computedBuffer.length) {
      return false;
    }

    return timingSafeEqual(hashBuffer, computedBuffer);
  }

  private cleanupExpiredFlows(): void {
    const now = Date.now();
    for (const [flowId, flow] of this.flows.entries()) {
      if (flow.expiresAt <= now) {
        this.flows.delete(flowId);
      }
    }
  }

  private ensureFlowCapacity(): void {
    if (this.maxPendingFlows <= 0 || this.flows.size < this.maxPendingFlows) {
      return;
    }

    const overflowCount = this.flows.size - this.maxPendingFlows + 1;
    const evictionOrder = [...this.flows.values()]
      .sort((left, right) => left.expiresAt - right.expiresAt)
      .slice(0, overflowCount);

    evictionOrder.forEach((flow) => {
      this.flows.delete(flow.flowId);
    });
  }

  private consumeFlow(flowId: string, kind: FlowKind): PendingFlow {
    this.cleanupExpiredFlows();
    const flow = this.flows.get(flowId);
    if (!flow || flow.kind !== kind || flow.expiresAt < Date.now()) {
      throw new BadRequestException('Flow expired or invalid');
    }
    this.flows.delete(flowId);
    return flow;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async runUserMutation<T>(task: () => Promise<T>): Promise<T> {
    let releaseCurrent: (() => void) | null = null;
    const previous = this.userMutationQueue;
    this.userMutationQueue = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent?.();
    }
  }

  private async runSessionMutation<T>(task: () => Promise<T>): Promise<T> {
    let releaseCurrent: (() => void) | null = null;
    const previous = this.sessionMutationQueue;
    this.sessionMutationQueue = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent?.();
    }
  }

  private async createSessionForUser(userId: string): Promise<{
    token: string;
    record: AuthSessionRecord;
  }> {
    return this.runSessionMutation(async () => {
      const now = Date.now();
      const sessions = await this.authStorageService.getSessions();
      const activeSessions = sessions.filter(
        (session) => session.expiresAt > now,
      );
      const token = randomBytes(32).toString('base64url');
      const record: AuthSessionRecord = {
        tokenHash: this.hashToken(token),
        userId,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: now + this.sessionTtlMs,
      };

      activeSessions.push(record);
      await this.authStorageService.replaceSessions(activeSessions);
      return { token, record };
    });
  }

  private async resolveSessionUser(
    token: string,
    touchSession: boolean,
  ): Promise<SessionUser | null> {
    return this.runSessionMutation(async () => {
      const normalizedToken = token.trim();
      if (!normalizedToken) {
        return null;
      }

      const tokenHash = this.hashToken(normalizedToken);
      const sessions = await this.authStorageService.getSessions();
      const now = Date.now();
      const activeSessions = sessions.filter(
        (session) => session.expiresAt > now,
      );
      const expiredSessionsRemoved = activeSessions.length !== sessions.length;
      let changed = expiredSessionsRemoved;

      const session = activeSessions.find(
        (entry) => entry.tokenHash === tokenHash,
      );
      if (!session) {
        if (changed) {
          await this.authStorageService.replaceSessions(activeSessions);
        }
        return null;
      }

      const users = await this.authStorageService.getUsers();
      const user = users.find((entry) => entry.id === session.userId);
      if (!user) {
        const filteredSessions = activeSessions.filter(
          (entry) => entry.tokenHash !== tokenHash,
        );
        await this.authStorageService.replaceSessions(filteredSessions);
        return null;
      }

      if (touchSession) {
        session.lastUsedAt = now;
        session.expiresAt = now + this.sessionTtlMs;
        changed = true;
      }

      if (changed) {
        await this.authStorageService.replaceSessions(activeSessions);
      }

      return { user, session };
    });
  }

  private enforceAuthRateWindowCapacity(): void {
    if (
      this.maxAuthRateWindows <= 0 ||
      this.authRateWindows.size <= this.maxAuthRateWindows
    ) {
      return;
    }

    const overflow = this.authRateWindows.size - this.maxAuthRateWindows;
    const keysToDelete = [...this.authRateWindows.keys()].slice(0, overflow);
    keysToDelete.forEach((key) => this.authRateWindows.delete(key));
  }
}
