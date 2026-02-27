import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';

const TRELLO_API = 'https://api.trello.com';

interface TrelloCredentials {
  api_key: string;
  token: string;
}

let _credentials: TrelloCredentials | null = null;
let _boardId: string | null = null;
let _listIds: Record<string, string> | null = null;

function loadCredentials(): TrelloCredentials | null {
  if (_credentials) return _credentials;

  const config = getConfig();
  const credPath = resolve(config.credentials_path, 'trello_credentials.json');

  try {
    const raw = readFileSync(credPath, 'utf-8');
    const parsed = JSON.parse(raw) as TrelloCredentials;

    if (!parsed.api_key || !parsed.token) {
      console.error('[trello] Missing api_key or token in credentials file');
      return null;
    }

    _credentials = parsed;
    return _credentials;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[trello] Failed to load credentials from ${credPath}: ${message}`);
    return null;
  }
}

function authParams(): string {
  const creds = loadCredentials();
  if (!creds) return '';
  return `key=${creds.api_key}&token=${creds.token}`;
}

async function trelloGet<T>(path: string, extraParams = ''): Promise<T | null> {
  const auth = authParams();
  if (!auth) return null;

  const sep = extraParams ? '&' : '';
  const url = `${TRELLO_API}${path}?${auth}${sep}${extraParams}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      console.error(`[trello] GET ${path} failed (${res.status}): ${body}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[trello] GET ${path} error: ${message}`);
    return null;
  }
}

async function trelloPost<T>(path: string, body: Record<string, string>): Promise<T | null> {
  const auth = authParams();
  if (!auth) return null;

  const url = `${TRELLO_API}${path}?${auth}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[trello] POST ${path} failed (${res.status}): ${text}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[trello] POST ${path} error: ${message}`);
    return null;
  }
}

async function trelloPut<T>(path: string, body: Record<string, string>): Promise<T | null> {
  const auth = authParams();
  if (!auth) return null;

  const url = `${TRELLO_API}${path}?${auth}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[trello] PUT ${path} failed (${res.status}): ${text}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[trello] PUT ${path} error: ${message}`);
    return null;
  }
}

// ── Board & List Resolution ───────────────────────────────

export async function resolveBoard(): Promise<string | null> {
  if (_boardId) return _boardId;

  const config = getConfig();
  const boards = await trelloGet<Array<{ id: string; name: string }>>('/1/members/me/boards', 'fields=name');
  if (!boards) return null;

  const match = boards.find(b => b.name === config.trello.board_name);
  if (!match) {
    console.error(`[trello] Board "${config.trello.board_name}" not found`);
    return null;
  }

  _boardId = match.id;
  console.log(`[trello] Resolved board "${config.trello.board_name}" → ${_boardId}`);
  return _boardId;
}

export async function resolveLists(): Promise<Record<string, string> | null> {
  if (_listIds) return _listIds;

  const boardId = await resolveBoard();
  if (!boardId) return null;

  const lists = await trelloGet<Array<{ id: string; name: string }>>(`/1/boards/${boardId}/lists`, 'fields=name');
  if (!lists) return null;

  const config = getConfig();
  const resolved: Record<string, string> = {};

  for (const [key, name] of Object.entries(config.trello.lists)) {
    const match = lists.find(l => l.name === name);
    if (match) {
      resolved[key] = match.id;
    } else {
      console.warn(`[trello] List "${name}" (key: ${key}) not found on board`);
    }
  }

  _listIds = resolved;
  console.log(`[trello] Resolved ${Object.keys(resolved).length} lists`);
  return _listIds;
}

// ── Card Operations ───────────────────────────────────────

export async function createCard(
  listKey: string,
  title: string,
  description: string,
): Promise<string | null> {
  const lists = await resolveLists();
  if (!lists || !lists[listKey]) {
    console.error(`[trello] Cannot create card: list "${listKey}" not resolved`);
    return null;
  }

  const card = await trelloPost<{ id: string }>('/1/cards', {
    idList: lists[listKey],
    name: title,
    desc: description,
  });

  return card?.id ?? null;
}

export async function moveCard(cardId: string, listKey: string): Promise<boolean> {
  const lists = await resolveLists();
  if (!lists || !lists[listKey]) {
    console.error(`[trello] Cannot move card: list "${listKey}" not resolved`);
    return false;
  }

  const result = await trelloPut(`/1/cards/${cardId}`, { idList: lists[listKey] });
  return result !== null;
}

export async function updateCard(cardId: string, fields: Record<string, string>): Promise<boolean> {
  const result = await trelloPut(`/1/cards/${cardId}`, fields);
  return result !== null;
}

export async function addComment(cardId: string, text: string): Promise<boolean> {
  const result = await trelloPost(`/1/cards/${cardId}/actions/comments`, { text });
  return result !== null;
}
