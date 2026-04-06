export interface AuthPasskeyCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AuthUserRecord {
  id: string;
  accountId: string;
  displayName: string;
  avatarEmoji: string;
  passwordHash?: string;
  passkeys: AuthPasskeyCredential[];
  createdAt: number;
  updatedAt: number;
}

export interface AuthSessionRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  lastUsedAt: number;
  createdAt: number;
}

export interface IAuthStorageService {
  /**
   * Return the current bounded user projection.
   */
  getUsers(): Promise<AuthUserRecord[]>;
  /**
   * Replace the bounded user projection while appending canonical auth-log
   * records for each mutation.
   */
  replaceUsers(users: AuthUserRecord[]): Promise<void>;
  /**
   * Return the current bounded session projection.
   */
  getSessions(): Promise<AuthSessionRecord[]>;
  /**
   * Replace the bounded session projection while appending canonical auth-log
   * records for each mutation.
   */
  replaceSessions(sessions: AuthSessionRecord[]): Promise<void>;
}
