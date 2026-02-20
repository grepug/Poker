export interface AuthUser {
  id: string;
  accountId: string;
  displayName: string;
  avatarEmoji: string;
  hasPassword: boolean;
  passkeyCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AuthModes {
  passkey: boolean;
  password: boolean;
}
