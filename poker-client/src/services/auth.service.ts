import type { AuthModes, AuthUser } from "poker-types";
import { resolveServerResourceUrl } from "./socket.service";

const AUTH_TOKEN_STORAGE_KEY = "poker.authToken";

type JsonRequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  token?: string | null;
};

async function requestJson<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(resolveServerResourceUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }

  return payload as T;
}

export const authTokenStorage = {
  key: AUTH_TOKEN_STORAGE_KEY,
  read(): string | null {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  },
  write(token: string) {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  },
  clear() {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  },
};

export type AuthSessionPayload = {
  sessionToken: string;
  user: AuthUser;
};

export const authService = {
  async getAuthModes(): Promise<AuthModes> {
    return requestJson<AuthModes>("/api/auth/modes");
  },

  async startPasskeyRegister(displayName: string, avatarEmoji: string) {
    return requestJson<{ flowId: string; options: unknown }>(
      "/api/auth/passkey/register/start",
      {
        method: "POST",
        body: { displayName, avatarEmoji },
      },
    );
  },

  async finishPasskeyRegister(
    flowId: string,
    response: unknown,
  ): Promise<AuthSessionPayload> {
    return requestJson<AuthSessionPayload>("/api/auth/passkey/register/finish", {
      method: "POST",
      body: { flowId, response },
    });
  },

  async startPasskeyLogin() {
    return requestJson<{ flowId: string; options: unknown }>(
      "/api/auth/passkey/login/start",
      {
        method: "POST",
      },
    );
  },

  async finishPasskeyLogin(
    flowId: string,
    response: unknown,
  ): Promise<AuthSessionPayload> {
    return requestJson<AuthSessionPayload>("/api/auth/passkey/login/finish", {
      method: "POST",
      body: { flowId, response },
    });
  },

  async loginWithPassword(accountId: string, password: string): Promise<AuthSessionPayload> {
    return requestJson<AuthSessionPayload>("/api/auth/password/login", {
      method: "POST",
      body: { accountId, password },
    });
  },

  async getMe(token: string): Promise<{ user: AuthUser; sessionExpiresAt: number; authModes: AuthModes }> {
    return requestJson<{ user: AuthUser; sessionExpiresAt: number; authModes: AuthModes }>(
      "/api/auth/me",
      {
        token,
      },
    );
  },

  async updateMyProfile(token: string, displayName: string, avatarEmoji: string): Promise<AuthUser> {
    const payload = await requestJson<{ user: AuthUser }>("/api/auth/me/profile", {
      method: "PATCH",
      token,
      body: { displayName, avatarEmoji },
    });
    return payload.user;
  },

  async logout(token: string | null): Promise<void> {
    if (!token) {
      return;
    }

    await requestJson<{ success: boolean }>("/api/auth/logout", {
      method: "POST",
      token,
    });
  },
};
