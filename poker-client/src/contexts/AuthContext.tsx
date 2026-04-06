/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type { AuthModes, AuthUser } from "poker-types";
import { authService } from "@/services/auth.service";

type AuthContextType = {
  user: AuthUser | null;
  authModes: AuthModes;
  isInitializing: boolean;
  isAuthenticated: boolean;
  passkeySupported: boolean;
  refreshSession: () => Promise<void>;
  registerWithPasskey: (
    displayName: string,
    avatarEmoji: string,
  ) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  loginWithPassword: (accountId: string, password: string) => Promise<void>;
  updateProfile: (
    displayName: string,
    avatarEmoji: string,
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const defaultModes: AuthModes = {
  passkey: true,
  password: false,
};

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authModes, setAuthModes] = useState<AuthModes>(defaultModes);
  const [isInitializing, setIsInitializing] = useState(true);

  const passkeySupported =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined";

  const persistSession = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
  }, []);

  const refreshModes = useCallback(async () => {
    const modes = await authService.getAuthModes();
    setAuthModes(modes);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const payload = await authService.getMe();
      setUser(payload.user);
      setAuthModes(payload.authModes);
    } catch {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    const bootstrap = async () => {
      setIsInitializing(true);
      try {
        await refreshModes();
      } catch {
        setAuthModes(defaultModes);
      }
      await refreshSession();
      setIsInitializing(false);
    };

    void bootstrap();
  }, [refreshModes, refreshSession]);

  const registerWithPasskey = useCallback(
    async (displayName: string, avatarEmoji: string) => {
      if (!passkeySupported) {
        throw new Error("Passkey is not supported on this browser");
      }

      const start = await authService.startPasskeyRegister(
        displayName,
        avatarEmoji,
      );
      const passkeyResponse = await startRegistration({
        optionsJSON: start.options as Parameters<
          typeof startRegistration
        >[0]["optionsJSON"],
      });
      const finish = await authService.finishPasskeyRegister(
        start.flowId,
        passkeyResponse,
      );
      persistSession(finish.user);
      setAuthModes(finish.authModes);
    },
    [passkeySupported, persistSession],
  );

  const loginWithPasskey = useCallback(async () => {
    if (!passkeySupported) {
      throw new Error("Passkey is not supported on this browser");
    }

    const start = await authService.startPasskeyLogin();
    const passkeyResponse = await startAuthentication({
      optionsJSON: start.options as Parameters<
        typeof startAuthentication
      >[0]["optionsJSON"],
    });
    const finish = await authService.finishPasskeyLogin(
      start.flowId,
      passkeyResponse,
    );
    persistSession(finish.user);
    setAuthModes(finish.authModes);
  }, [passkeySupported, persistSession]);

  const loginWithPassword = useCallback(
    async (accountId: string, password: string) => {
      const payload = await authService.loginWithPassword(accountId, password);
      persistSession(payload.user);
      setAuthModes(payload.authModes);
    },
    [persistSession],
  );

  const updateProfile = useCallback(
    async (displayName: string, avatarEmoji: string) => {
      if (!user) {
        throw new Error("Not authenticated");
      }
      const updatedUser = await authService.updateMyProfile(
        displayName,
        avatarEmoji,
      );
      setUser(updatedUser);
      return updatedUser;
    },
    [user],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.warn("Logout request failed", error);
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      authModes,
      isInitializing,
      isAuthenticated: Boolean(user),
      passkeySupported,
      refreshSession,
      registerWithPasskey,
      loginWithPasskey,
      loginWithPassword,
      updateProfile,
      logout,
    }),
    [
      user,
      authModes,
      isInitializing,
      passkeySupported,
      refreshSession,
      registerWithPasskey,
      loginWithPasskey,
      loginWithPassword,
      updateProfile,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
