import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSession, TEST_SESSION_TOKEN } from '../__fixtures__/test-helpers.js';
import type { Session } from '../types.js';

const TEST_UUID = '00000000-1111-2222-3333-444444444444';

// Keep a reference to the session so tests can control lookup results
let storedSession: Session | undefined;

vi.mock('../session/manager.js', async () => {
  const actual = await vi.importActual<typeof import('../session/manager.js')>('../session/manager.js');
  return {
    ...actual,
    getSession: () => storedSession,
  };
});

const { sessionLookup } = await import('./session-lookup.js');

function makeMockReqRes(sessionId: string, authHeader?: string) {
  const req = {
    params: { id: sessionId },
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  } as unknown as import('express').Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    locals: {},
  } as unknown as import('express').Response;

  const next = vi.fn();

  return { req, res, next };
}

describe('sessionLookup middleware', () => {
  beforeEach(() => {
    storedSession = makeSession({ id: TEST_UUID });
  });

  it('passes through with valid session ID + valid token', () => {
    const { req, res, next } = makeMockReqRes(TEST_UUID, `Bearer ${TEST_SESSION_TOKEN}`);
    sessionLookup(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals.session).toBe(storedSession);
  });

  it('rejects with 403 when token is missing', () => {
    const { req, res, next } = makeMockReqRes(TEST_UUID);
    sessionLookup(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_token' }));
  });

  it('rejects with 403 when token is wrong', () => {
    const { req, res, next } = makeMockReqRes(TEST_UUID, 'Bearer wrong-token');
    sessionLookup(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_token' }));
  });

  it('rejects with 403 when Authorization header is malformed', () => {
    const { req, res, next } = makeMockReqRes(TEST_UUID, 'Basic abc123');
    sessionLookup(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects with 400 for invalid session ID format', () => {
    storedSession = undefined;
    const { req, res, next } = makeMockReqRes('not-a-uuid', `Bearer ${TEST_SESSION_TOKEN}`);
    sessionLookup(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects with 404 when session not found', () => {
    storedSession = undefined;
    const { req, res, next } = makeMockReqRes(TEST_UUID, `Bearer ${TEST_SESSION_TOKEN}`);
    sessionLookup(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects with 410 when session is closed', () => {
    storedSession = makeSession({ id: TEST_UUID, status: 'closed' });
    const { req, res, next } = makeMockReqRes(TEST_UUID, `Bearer ${TEST_SESSION_TOKEN}`);
    sessionLookup(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(410);
  });
});
