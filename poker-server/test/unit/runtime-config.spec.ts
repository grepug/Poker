import {
  createRuntimeConfigScript,
  resolveRequestOrigin,
} from '../../src/runtime-config';

describe('runtime-config', () => {
  it('prefers forwarded origin headers when present', () => {
    const origin = resolveRequestOrigin({
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3025',
        'x-forwarded-proto': 'https',
        'x-forwarded-host':
          'angel-stretch-modem-characteristic.trycloudflare.com',
      },
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'host' ? '127.0.0.1:3025' : undefined,
      ),
    } as any);

    expect(origin).toBe(
      'https://angel-stretch-modem-characteristic.trycloudflare.com',
    );
  });

  it('falls back to the direct request origin without forwarded headers', () => {
    const origin = resolveRequestOrigin({
      protocol: 'http',
      headers: {
        host: 'localhost:3025',
      },
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'host' ? 'localhost:3025' : undefined,
      ),
    } as any);

    expect(origin).toBe('http://localhost:3025');
  });

  it('embeds the resolved server origin into the runtime script', () => {
    expect(
      createRuntimeConfigScript(
        'https://angel-stretch-modem-characteristic.trycloudflare.com',
      ),
    ).toContain(
      '"https://angel-stretch-modem-characteristic.trycloudflare.com"',
    );
  });
});
