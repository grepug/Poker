import type { AuthModes, AuthUser } from "poker-types";
import { resolveServerResourceUrl } from "./socket.service";

type JsonRequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

async function requestJson<T>(
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
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

export type AuthSessionPayload = {
  user: AuthUser;
  sessionExpiresAt: number;
  authModes: AuthModes;
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
    return requestJson<AuthSessionPayload>(
      "/api/auth/passkey/register/finish",
      {
        method: "POST",
        body: { flowId, response },
      },
    );
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

  async loginWithPassword(
    accountId: string,
    password: string,
  ): Promise<AuthSessionPayload> {
    return requestJson<AuthSessionPayload>("/api/auth/password/login", {
      method: "POST",
      body: { accountId, password },
    });
  },

  async getMe(): Promise<{
    user: AuthUser;
    sessionExpiresAt: number;
    authModes: AuthModes;
  }> {
    return requestJson<{
      user: AuthUser;
      sessionExpiresAt: number;
      authModes: AuthModes;
    }>("/api/auth/me");
  },

  async updateMyProfile(
    displayName: string,
    avatarEmoji: string,
  ): Promise<AuthUser> {
    const payload = await requestJson<{ user: AuthUser }>(
      "/api/auth/me/profile",
      {
        method: "PATCH",
        body: { displayName, avatarEmoji },
      },
    );
    return payload.user;
  },

  async logout(): Promise<void> {
    await requestJson<{ success: boolean }>("/api/auth/logout", {
      method: "POST",
    });
  },
};
