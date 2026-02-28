import { Router } from 'express';
import { getConfig } from '../config.js';
import { createSession, hashIp } from '../session/manager.js';
import { isBlocked } from '../security/ip-blocklist.js';
import type { Language } from '../types.js';

const router = Router();
const VALID_LANGUAGES: Language[] = ['en', 'de', 'pt'];

router.post('/api/session', async (req, res) => {
  const config = getConfig();

  // Check if IP is blocked
  const ipHash = hashIp(req.ip || req.socket.remoteAddress || 'unknown');
  if (isBlocked(ipHash)) {
    res.status(403).json({ error: 'blocked', message: 'Access denied.' });
    return;
  }
  const body = req.body as {
    language?: string;
    referrer?: string;
    turnstile_token?: string;
    metadata?: Record<string, unknown>;
  };

  // Validate language
  const language: Language = VALID_LANGUAGES.includes(body.language as Language)
    ? (body.language as Language)
    : 'en';

  // Turnstile verification (skip in dev mode)
  if (!config.dev_mode) {
    const token = body.turnstile_token || req.headers['x-turnstile-token'];
    if (!token) {
      res.status(403).json({ error: 'verification_failed', message: "We couldn't verify your request. Please refresh and try again." });
      return;
    }

    // Verify with Cloudflare
    try {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: config.turnstile_secret,
          response: token,
          remoteip: req.ip,
        }),
      });
      const result = await verifyRes.json() as { success: boolean };
      if (!result.success) {
        res.status(403).json({ error: 'verification_failed', message: "We couldn't verify your request. Please refresh and try again." });
        return;
      }
    } catch {
      res.status(403).json({ error: 'verification_failed', message: "We couldn't verify your request. Please refresh and try again." });
      return;
    }
  }

  const { session, status, queuePosition } = createSession({
    language,
    ipHash,
    referrer: body.referrer,
    userAgent: req.headers['user-agent'],
    metadata: body.metadata,
  });

  if (status === 'queued') {
    res.status(202).json({
      session_id: session.id,
      status: 'queued',
      queue: {
        position: queuePosition,
        estimated_wait_seconds: (queuePosition ?? 1) * 15,
      },
      config: {
        max_message_length: 2000,
        languages: config.client.languages,
      },
    });
    return;
  }

  const consentConfig = config.consent_messages[language] || config.consent_messages.en;

  res.status(200).json({
    session_id: session.id,
    status: 'active',
    greeting: {
      language,
      text: config.greetings[language],
    },
    consent_request: {
      text: consentConfig.text,
      privacy_url: consentConfig.privacy_url,
      options: {
        accept: consentConfig.accept_label,
        decline: consentConfig.decline_label,
      },
    },
    config: {
      max_message_length: 2000,
      languages: config.client.languages,
    },
  });
});

export default router;
