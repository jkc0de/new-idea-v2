import { Platform } from 'react-native';

import { storage } from './storage';

/**
 * Where the booking server lives. Set EXPO_PUBLIC_API_URL for builds.
 * On a real phone, "localhost" is the phone itself, so use your computer's LAN IP
 * (e.g. http://192.168.1.20:3000). It can also be changed in-app on the welcome screen.
 */
function defaultBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === 'web' && typeof location !== 'undefined') return `${location.protocol}//${location.hostname}:3000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000'; // Android emulator → host machine
  return 'http://localhost:3000';
}

let baseUrl = defaultBaseUrl();
let token: string | null = null;

export async function loadApiConfig() {
  const [savedUrl, savedToken] = await Promise.all([storage.get('apiUrl'), storage.get('token')]);
  if (savedUrl) baseUrl = savedUrl;
  token = savedToken;
  return { baseUrl, token };
}

export function getBaseUrl() { return baseUrl; }
export async function setBaseUrl(url: string) {
  baseUrl = url.trim().replace(/\/+$/, '') || defaultBaseUrl();
  await storage.set('apiUrl', baseUrl);
}

export async function setToken(t: string | null) {
  token = t;
  await storage.set('token', t);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = any>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(opts.body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${baseUrl}`, 0);
  }
  let data: any = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export const qs = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();
