import type { CookieOptions, Request, Response } from 'express';

export const AUTH_SESSION_COOKIE_NAME =
  process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'poker_session';

const AUTH_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
const AUTH_COOKIE_SAME_SITE =
  process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase() || 'lax';
const AUTH_COOKIE_SECURE_OVERRIDE = process.env.AUTH_COOKIE_SECURE?.trim();

const resolveSameSite = (): CookieOptions['sameSite'] => {
  if (AUTH_COOKIE_SAME_SITE === 'strict') {
    return 'strict';
  }
  if (AUTH_COOKIE_SAME_SITE === 'none') {
    return 'none';
  }
  return 'lax';
};

const resolveSecureCookie = (
  request: Pick<Request, 'protocol' | 'headers'>,
): boolean => {
  if (AUTH_COOKIE_SECURE_OVERRIDE === 'true') {
    return true;
  }
  if (AUTH_COOKIE_SECURE_OVERRIDE === 'false') {
    return false;
  }

  const forwardedProto = request.headers['x-forwarded-proto'];
  const normalizedForwardedProto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;
  if (typeof normalizedForwardedProto === 'string') {
    const firstProto = normalizedForwardedProto
      .split(',')[0]
      ?.trim()
      .toLowerCase();
    if (firstProto === 'https') {
      return true;
    }
    if (firstProto === 'http') {
      return false;
    }
  }

  if (request.protocol === 'https') {
    return true;
  }

  const originHeader = request.headers.origin;
  if (typeof originHeader === 'string') {
    try {
      return new URL(originHeader).protocol === 'https:';
    } catch {
      return false;
    }
  }

  return false;
};

const baseCookieOptions = (
  request: Pick<Request, 'protocol' | 'headers'>,
): CookieOptions => ({
  httpOnly: true,
  path: '/',
  sameSite: resolveSameSite(),
  secure: resolveSecureCookie(request),
  ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {}),
});

export const setAuthSessionCookie = (
  request: Pick<Request, 'protocol' | 'headers'>,
  response: Response,
  token: string,
  expiresAt: number,
): void => {
  response.cookie(AUTH_SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(request),
    expires: new Date(expiresAt),
    maxAge: Math.max(0, expiresAt - Date.now()),
  });
};

export const clearAuthSessionCookie = (
  request: Pick<Request, 'protocol' | 'headers'>,
  response: Response,
): void => {
  response.clearCookie(AUTH_SESSION_COOKIE_NAME, baseCookieOptions(request));
};

export const readAuthSessionCookie = (
  cookieHeader: string | string[] | undefined,
): string | null => {
  const rawCookieHeader = Array.isArray(cookieHeader)
    ? cookieHeader.join('; ')
    : cookieHeader;
  if (!rawCookieHeader) {
    return null;
  }

  for (const pair of rawCookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = pair.split('=');
    if (!rawName || rawValueParts.length === 0) {
      continue;
    }

    if (rawName.trim() !== AUTH_SESSION_COOKIE_NAME) {
      continue;
    }

    const rawValue = rawValueParts.join('=').trim();
    if (!rawValue) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
};
