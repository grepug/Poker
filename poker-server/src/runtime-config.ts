import type { Request } from 'express';

const readForwardedHeader = (
  value: string | string[] | undefined,
): string | undefined => {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized?.split(',')[0]?.trim() || undefined;
};

export const resolveRequestOrigin = (
  request: Pick<Request, 'protocol' | 'headers' | 'get'>,
): string => {
  const forwardedProto = readForwardedHeader(
    request.headers['x-forwarded-proto'],
  );
  const forwardedHost = readForwardedHeader(request.headers['x-forwarded-host']);
  const directHost =
    request.get('host') || readForwardedHeader(request.headers.host);
  const protocol = forwardedProto || request.protocol || 'http';
  const host = forwardedHost || directHost;

  return host ? `${protocol}://${host}` : '';
};

export const createRuntimeConfigScript = (serverUrl: string): string => {
  if (!serverUrl) {
    return 'window.__POKER_RUNTIME_CONFIG__ = window.__POKER_RUNTIME_CONFIG__ || {};\n';
  }

  return `window.__POKER_RUNTIME_CONFIG__ = Object.assign(window.__POKER_RUNTIME_CONFIG__ || {}, { serverUrl: ${JSON.stringify(serverUrl)} });\n`;
};
