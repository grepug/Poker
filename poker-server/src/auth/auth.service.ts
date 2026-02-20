import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'crypto';
import type {
  AuthSessionRecord,
  AuthUserRecord,
  IAuthStorageService,
} from '../common/interfaces/auth-storage.interface';
import type { IStorageService } from '../common/interfaces/storage.interface';
import { realtimeEventBus } from '../common/realtime-events';

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

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly flows = new Map<string, PendingFlow>();
  private readonly sessionTtlMs = 365 * 24 * 60 * 60 * 1000;
  private readonly passwordLoginEnabled =
    process.env.AUTH_PASSWORD_LOGIN_ENABLED?.trim() === 'true' ||
    process.env.NODE_ENV !== 'production';
  private readonly rpName = process.env.WEBAUTHN_RP_NAME?.trim() || 'Poker Game';
  private readonly rpId = process.env.WEBAUTHN_RP_ID?.trim() || 'localhost';
  private readonly expectedOrigins = (
    process.env.WEBAUTHN_ORIGIN?.trim() || 'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  constructor(
    @Inject('IAuthStorageService')
    private readonly authStorageService: IAuthStorageService,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeededPasswordUsers();
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
  }): Promise<{ flowId: string; options: unknown }> {
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
  }): Promise<{ sessionToken: string; user: PublicAuthUser }> {
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
      throw new UnauthorizedException('Passkey registration verification failed');
    }

    const registrationInfo: any = verification.registrationInfo;
    const credentialId: string =
      registrationInfo.credential?.id ||
      Buffer.from(registrationInfo.credentialID).toString('base64url');
    const publicKey: string =
      registrationInfo.credential?.publicKey
        ? Buffer.from(registrationInfo.credential.publicKey).toString('base64url')
        : Buffer.from(registrationInfo.credentialPublicKey).toString('base64url');
    const counter: number =
      registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0;
    const transports: string[] | undefined = Array.isArray(
      registrationInfo.credential?.transports,
    )
      ? registrationInfo.credential.transports
      : undefined;

    const users = await this.authStorageService.getUsers();
    this.assertDisplayNameAvailable(draftUser.displayName, users);
    const credentialAlreadyUsed = users.some((user) =>
      user.passkeys.some((passkey) => passkey.credentialId === credentialId),
    );
    if (credentialAlreadyUsed) {
      throw new BadRequestException('Passkey is already registered');
    }

    const now = Date.now();
    const user: AuthUserRecord = {
      id: draftUser.id,
      accountId: draftUser.accountId,
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

    users.push(user);
    await this.authStorageService.saveUsers(users);

    const session = await this.createSessionForUser(user.id);
    return {
      sessionToken: session.token,
      user: this.toPublicUser(user),
    };
  }

  async startPasskeyLogin(): Promise<{ flowId: string; options: unknown }> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'required',
    });

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
  }): Promise<{ sessionToken: string; user: PublicAuthUser }> {
    const flow = this.consumeFlow(input.flowId, 'passkey-login');
    const response: any = input.response;
    const credentialId: string = response?.id;
    if (!credentialId) {
      throw new BadRequestException('Missing credential id');
    }

    const users = await this.authStorageService.getUsers();
    const user = users.find((candidate) =>
      candidate.passkeys.some((passkey) => passkey.credentialId === credentialId),
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
      passkey.counter = authenticationInfo.newCounter;
      passkey.updatedAt = Date.now();
      await this.authStorageService.saveUsers(users);
    }

    const session = await this.createSessionForUser(user.id);
    return {
      sessionToken: session.token,
      user: this.toPublicUser(user),
    };
  }

  async loginWithPassword(input: {
    accountId: string;
    password: string;
  }): Promise<{ sessionToken: string; user: PublicAuthUser }> {
    if (!this.passwordLoginEnabled) {
      throw new ForbiddenException('Password login is disabled');
    }

    const accountId = input.accountId.trim();
    if (!accountId) {
      throw new BadRequestException('Account is required');
    }

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
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return;
    }

    const tokenHash = this.hashToken(normalizedToken);
    const sessions = await this.authStorageService.getSessions();
    const nextSessions = sessions.filter((session) => session.tokenHash !== tokenHash);
    if (nextSessions.length !== sessions.length) {
      await this.authStorageService.saveSessions(nextSessions);
    }
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
    const users = await this.authStorageService.getUsers();
    const user = users.find((entry) => entry.id === input.userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const duplicated = users.find(
      (entry) => entry.displayName === displayName && entry.id !== input.userId,
    );
    if (duplicated) {
      throw new BadRequestException('Display name is already taken');
    }

    user.displayName = displayName;
    user.avatarEmoji = avatarEmoji;
    user.updatedAt = Date.now();
    await this.authStorageService.saveUsers(users);
    await this.applyProfileToRooms(user);
    return this.toPublicUser(user);
  }

  private async applyProfileToRooms(user: AuthUserRecord): Promise<void> {
    const rooms = await this.storageService.getAllRooms();
    const now = Date.now();
    const changedRooms = rooms.filter((room) => {
      let changed = false;
      room.players.forEach((player) => {
        if (player.userId === user.id) {
          player.name = user.displayName;
          player.emoji = user.avatarEmoji;
          changed = true;
          realtimeEventBus.emitEvent('PLAYER_PROFILE_UPDATED', {
            roomId: room.id,
            playerId: player.id,
            playerName: user.displayName,
            playerEmoji: user.avatarEmoji,
          });
        }
      });
      if (changed) {
        room.lastActivityAt = now;
      }
      return changed;
    });

    for (const room of changedRooms) {
      await this.storageService.saveRoom(room);
    }
  }

  private async ensureSeededPasswordUsers(): Promise<void> {
    if (!this.passwordLoginEnabled) {
      return;
    }

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
      await this.authStorageService.saveUsers(users);
    }
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

  private async createSessionForUser(userId: string): Promise<{
    token: string;
    record: AuthSessionRecord;
  }> {
    const sessions = await this.authStorageService.getSessions();
    const now = Date.now();
    const token = randomBytes(32).toString('base64url');
    const record: AuthSessionRecord = {
      tokenHash: this.hashToken(token),
      userId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + this.sessionTtlMs,
    };

    sessions.push(record);
    await this.authStorageService.saveSessions(sessions);
    return { token, record };
  }

  private async resolveSessionUser(
    token: string,
    touchSession: boolean,
  ): Promise<SessionUser | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return null;
    }

    const tokenHash = this.hashToken(normalizedToken);
    const sessions = await this.authStorageService.getSessions();
    const now = Date.now();
    const activeSessions = sessions.filter((session) => session.expiresAt > now);
    const expiredSessionsRemoved = activeSessions.length !== sessions.length;
    let changed = expiredSessionsRemoved;

    const session = activeSessions.find((entry) => entry.tokenHash === tokenHash);
    if (!session) {
      if (changed) {
        await this.authStorageService.saveSessions(activeSessions);
      }
      return null;
    }

    const users = await this.authStorageService.getUsers();
    const user = users.find((entry) => entry.id === session.userId);
    if (!user) {
      const filteredSessions = activeSessions.filter(
        (entry) => entry.tokenHash !== tokenHash,
      );
      await this.authStorageService.saveSessions(filteredSessions);
      return null;
    }

    if (touchSession) {
      session.lastUsedAt = now;
      session.expiresAt = now + this.sessionTtlMs;
      changed = true;
    }

    if (changed) {
      await this.authStorageService.saveSessions(activeSessions);
    }

    return { user, session };
  }
}
