import { describe, expect, it } from 'vitest';
import {
  buildConnectionDeepLink,
  classifyConnectionError,
  normalizeDeepLinkServerUrl,
  parseConnectionDeepLink,
} from '../services/jupyter/connectionDeepLink';
import { JupyterGatewayError } from '../services/jupyter/JupyterGateway';

describe('connectionDeepLink', () => {
  it('ignores empty or unrelated hashes', () => {
    expect(parseConnectionDeepLink('')).toEqual({
      hasConnectionParams: false,
      cleanedHash: '',
    });
    expect(parseConnectionDeepLink('#section-2')).toEqual({
      hasConnectionParams: false,
      cleanedHash: '#section-2',
    });
  });

  it('parses server and token from hash and strips trailing slash', () => {
    const res = parseConnectionDeepLink('#server=http%3A%2F%2Flocalhost%3A8888%2F&token=my-secret-token');
    expect(res).toEqual({
      hasConnectionParams: true,
      serverUrl: 'http://localhost:8888',
      token: 'my-secret-token',
      cleanedHash: '',
    });
  });

  it('preserves unrelated hash parameters and route prefix when cleaning credentials', () => {
    const res = parseConnectionDeepLink(
      '#/notes?foo=1&server=https://jupyter.local:8888&token=abc&bar=2'
    );
    expect(res).toEqual({
      hasConnectionParams: true,
      serverUrl: 'https://jupyter.local:8888',
      token: 'abc',
      cleanedHash: '#/notes?foo=1&bar=2',
    });
  });

  it('supports token-only or empty-token deep links', () => {
    expect(parseConnectionDeepLink('#token=only-tok')).toEqual({
      hasConnectionParams: true,
      serverUrl: undefined,
      token: 'only-tok',
      cleanedHash: '',
    });

    expect(parseConnectionDeepLink('#server=http://127.0.0.1:8888&token=')).toEqual({
      hasConnectionParams: true,
      serverUrl: 'http://127.0.0.1:8888',
      token: '',
      cleanedHash: '',
    });
  });

  it('rejects non-http(s) and malformed server URLs', () => {
    expect(normalizeDeepLinkServerUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeDeepLinkServerUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeDeepLinkServerUrl('not-a-url')).toBeNull();

    const invalidOnly = parseConnectionDeepLink('#server=javascript:alert(1)');
    expect(invalidOnly.hasConnectionParams).toBe(false);
    expect(invalidOnly.serverUrl).toBeUndefined();
    expect(invalidOnly.cleanedHash).toBe('');
  });

  it('builds a clean deep link URL', () => {
    const url = buildConnectionDeepLink(
      'https://FedericoCAlonso.github.io/notelab-m3/#old',
      'http://localhost:8888/',
      'tok123'
    );
    expect(url).toBe(
      'https://FedericoCAlonso.github.io/notelab-m3/#server=http%3A%2F%2Flocalhost%3A8888&token=tok123'
    );
  });

  it('classifies auth, timeout, server and network/CORS errors accurately', () => {
    expect(classifyConnectionError(new JupyterGatewayError('HTTP 401', 401, false)).kind).toBe('auth');
    expect(classifyConnectionError(new JupyterGatewayError('HTTP 403', 403, false)).kind).toBe('auth');
    expect(classifyConnectionError(new JupyterGatewayError('HTTP 502', 502, false)).kind).toBe('server');
    expect(classifyConnectionError(new JupyterGatewayError('The user aborted a request', undefined, true)).kind).toBe('timeout');
    expect(classifyConnectionError(new JupyterGatewayError('Failed to fetch', undefined, true)).kind).toBe('network_or_cors');
  });
});
