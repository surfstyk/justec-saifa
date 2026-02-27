import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';

interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface CachedToken {
  access_token: string;
  expires_at: number;
}

let _credentials: OAuthCredentials | null = null;
let _cachedToken: CachedToken | null = null;

function loadCredentials(): OAuthCredentials {
  if (_credentials) return _credentials;

  const config = getConfig();
  const credPath = resolve(config.credentials_path, 'google_oauth.json');

  try {
    const raw = readFileSync(credPath, 'utf-8');
    _credentials = JSON.parse(raw) as OAuthCredentials;

    if (!_credentials.client_id || !_credentials.client_secret || !_credentials.refresh_token) {
      throw new Error('Missing required fields: client_id, client_secret, refresh_token');
    }

    return _credentials;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`[google-auth] Failed to load credentials from ${credPath}: ${message}`);
  }
}

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (60s margin)
  if (_cachedToken && Date.now() < _cachedToken.expires_at - 60_000) {
    return _cachedToken.access_token;
  }

  const creds = loadCredentials();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[google-auth] Token refresh failed (${response.status}): ${body}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  _cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return _cachedToken.access_token;
}
