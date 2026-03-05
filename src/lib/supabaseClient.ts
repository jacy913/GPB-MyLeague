import { createClient } from '@supabase/supabase-js';

const normalizeEnv = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().replace(/^['"]|['"]$/g, '')
    : '';

const supabaseUrl = normalizeEnv(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = normalizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);
const localOnlyFlag = normalizeEnv(import.meta.env.VITE_LOCAL_ONLY).toLowerCase();
const isLocalOnlyMode = localOnlyFlag === 'true' || localOnlyFlag === '1' || localOnlyFlag === 'yes';
const supabaseOrigin = (() => {
  if (!supabaseUrl) {
    return '';
  }
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return '';
  }
})();
const DEV_SUPABASE_PROXY_PREFIX = '/_supabase';

const toProxyUrl = (url: string): string => {
  if (!supabaseOrigin) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (parsed.origin === supabaseOrigin) {
      return `${DEV_SUPABASE_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // If URL parsing fails, keep the original input.
  }

  return url;
};

const proxyAwareFetch: typeof fetch = (input, init) => {
  if (!import.meta.env.DEV || !supabaseOrigin) {
    return fetch(input, init);
  }

  if (input instanceof Request) {
    const proxied = toProxyUrl(input.url);
    if (proxied === input.url) {
      return fetch(input, init);
    }
    return fetch(new Request(proxied, input), init);
  }

  const rawUrl = typeof input === 'string' ? input : input.toString();
  const proxied = toProxyUrl(rawUrl);
  return fetch(proxied, init);
};

export const isLocalOnly = isLocalOnlyMode;

const canUseSupabase = !isLocalOnlyMode && Boolean(supabaseOrigin && supabaseAnonKey);
export const isSupabaseConfigured = canUseSupabase;

export const supabase = canUseSupabase
  ? createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        fetch: proxyAwareFetch,
      },
    })
  : null;
