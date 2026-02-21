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
  getUsers(): Promise<AuthUserRecord[]>;
  saveUsers(users: AuthUserRecord[]): Promise<void>;
  getSessions(): Promise<AuthSessionRecord[]>;
  saveSessions(sessions: AuthSessionRecord[]): Promise<void>;
}
