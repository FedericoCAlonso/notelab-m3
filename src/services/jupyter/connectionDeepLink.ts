export interface ConnectionDeepLinkResult {
  hasConnectionParams: boolean;
  serverUrl?: string;
  token?: string;
  cleanedHash: string;
}

const CONNECTION_PARAM_KEYS = new Set(['server', 'token']);

/**
 * Validates and normalizes a Jupyter server URL from a deep-link hash.
 * Only http: and https: protocols are allowed.
 */
export function normalizeDeepLinkServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Strip trailing slashes while preserving path if present
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Parses connection parameters from window.location.hash (e.g. `#server=http://localhost:8888&token=abc`).
 * Uses URL hash fragments so tokens are never sent in HTTP requests or Referer headers.
 * Returns `cleanedHash` preserving any unrelated hash parameters.
 */
export function parseConnectionDeepLink(hash: string): ConnectionDeepLinkResult {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.trim()) {
    return { hasConnectionParams: false, cleanedHash: '' };
  }

  // Handle `#?server=...` or `#/route?server=...` defensively
  let paramString = raw;
  let routePrefix = '';
  const qIdx = raw.indexOf('?');
  if (qIdx >= 0) {
    routePrefix = raw.slice(0, qIdx);
    paramString = raw.slice(qIdx + 1);
  } else if (!raw.includes('=')) {
    return { hasConnectionParams: false, cleanedHash: hash.startsWith('#') ? hash : `#${hash}` };
  }

  const params = new URLSearchParams(paramString);
  const rawServer = params.get('server');
  const rawToken = params.get('token');

  const hasAnyKey = rawServer !== null || rawToken !== null;
  if (!hasAnyKey) {
    return {
      hasConnectionParams: false,
      cleanedHash: hash.startsWith('#') ? hash : `#${hash}`,
    };
  }

  let serverUrl: string | undefined;
  if (rawServer !== null) {
    const normalized = normalizeDeepLinkServerUrl(rawServer);
    if (normalized) {
      serverUrl = normalized;
    }
  }

  const token = rawToken !== null ? rawToken.trim() : undefined;

  // Rebuild remaining hash without sensitive connection parameters
  const remaining = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    if (!CONNECTION_PARAM_KEYS.has(k)) {
      remaining.append(k, v);
    }
  }
  const remainingStr = remaining.toString();
  let cleanedHash = '';
  if (routePrefix && remainingStr) {
    cleanedHash = `#${routePrefix}?${remainingStr}`;
  } else if (routePrefix) {
    cleanedHash = `#${routePrefix}`;
  } else if (remainingStr) {
    cleanedHash = `#${remainingStr}`;
  }

  return {
    hasConnectionParams: serverUrl !== undefined || token !== undefined,
    serverUrl,
    token,
    cleanedHash,
  };
}

export function buildConnectionDeepLink(
  pwaBaseUrl: string,
  serverUrl: string,
  token: string
): string {
  const base = pwaBaseUrl.split('#')[0] ?? pwaBaseUrl;
  const params = new URLSearchParams();
  params.set('server', serverUrl.replace(/\/+$/, ''));
  if (token.trim()) {
    params.set('token', token.trim());
  }
  return `${base}#${params.toString()}`;
}

export type ConnectionErrorKind = 'auth' | 'timeout' | 'network_or_cors' | 'server' | 'unknown';

export interface ClassifiedConnectionError {
  kind: ConnectionErrorKind;
  message: string;
}

export function classifyConnectionError(
  error: unknown,
  statusOverride?: number
): ClassifiedConnectionError {
  const status =
    statusOverride ??
    (typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: number }).status
      : undefined);

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Error desconocido de conexión';

  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      message: `Token inválido o rechazado (HTTP ${status}). Verifica el token o relanza 'notelab'.`,
    };
  }

  if (status !== undefined && status >= 400) {
    return {
      kind: 'server',
      message: `Jupyter respondió con error (${rawMessage}).`,
    };
  }

  const lower = rawMessage.toLowerCase();
  if (lower.includes('abort') || lower.includes('timeout')) {
    return {
      kind: 'timeout',
      message: 'Tiempo de espera agotado. Verifica que Jupyter Server esté activo y accesible.',
    };
  }

  const isNetworkFlag =
    typeof error === 'object' &&
    error !== null &&
    'isNetworkError' in error &&
    Boolean((error as { isNetworkError?: boolean }).isNetworkError);

  if (
    isNetworkFlag ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('fetch')
  ) {
    return {
      kind: 'network_or_cors',
      message:
        'No se pudo conectar con Jupyter. Verifica que el servidor esté corriendo y que CORS (allow_origin) permita este origen.',
    };
  }

  return {
    kind: 'unknown',
    message: rawMessage,
  };
}
