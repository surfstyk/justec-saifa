import type { InputFilterResult } from '../types.js';

// Known injection patterns
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above/i,
  /disregard\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*/i,
  /\bDAN\b.*\bmode\b/i,
  /jailbreak/i,
  /repeat\s+(the\s+)?(text|prompt|instructions)\s+(above|below)/i,
  /what\s+(are|is)\s+your\s+(system\s+)?prompt/i,
  /show\s+me\s+your\s+(system\s+)?(prompt|instructions)/i,
  /print\s+your\s+(system\s+)?prompt/i,
  /output\s+your\s+(initial|system)\s+/i,
  /\[\s*INST\s*\]/i,
  /<<\s*SYS\s*>>/i,
  /\bAssistant\s*:\s*/i,
  /\bHuman\s*:\s*/i,
];

// Profanity patterns (basic coverage for en/de/pt)
const PROFANITY_PATTERNS = [
  // English
  /\b(fuck|shit|ass|bitch|damn|cunt|dick|bastard|whore|slut)\w*\b/i,
  // German
  /\b(scheiße|scheisse|arschloch|hurensohn|wichser|fotze|fick)\w*\b/i,
  // Portuguese
  /\b(merda|caralho|puta|foda-se|fdp|corno|cabrão)\w*\b/i,
];

// Hostile language patterns
const HOSTILITY_PATTERNS = [
  /\b(kill|murder|die|death\s+threat|bomb)\b/i,
  /\bi\s+(will|want\s+to)\s+(hurt|harm|destroy|attack)/i,
  /\byou\s+(suck|are\s+(?:stupid|useless|garbage|trash))/i,
];

const MAX_MESSAGE_LENGTH = 2000;
const RAPID_FIRE_MS = 3000;

const lastMessageTime = new Map<string, number>();

export function filterInput(
  text: string,
  sessionId: string,
  _ipHash: string,
): InputFilterResult {
  // Length check
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      passed: false,
      modified_text: text.slice(0, MAX_MESSAGE_LENGTH),
      threat_level: 1,
      reason: 'message_too_long',
    };
  }

  // Rapid-fire detection
  const now = Date.now();
  const lastTime = lastMessageTime.get(sessionId);
  if (lastTime && (now - lastTime) < RAPID_FIRE_MS) {
    // Don't block, but flag
    lastMessageTime.set(sessionId, now);
    // Continue processing — rapid fire alone isn't enough to block
  }
  lastMessageTime.set(sessionId, now);

  // Injection pattern scan
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        passed: true, // Still pass (let the guard handle escalation)
        modified_text: text,
        threat_level: 2,
        reason: 'injection_attempt',
      };
    }
  }

  // Hostility check (higher threat level)
  for (const pattern of HOSTILITY_PATTERNS) {
    if (pattern.test(text)) {
      return {
        passed: true,
        modified_text: text,
        threat_level: 3,
        reason: 'hostility',
      };
    }
  }

  // Profanity check
  for (const pattern of PROFANITY_PATTERNS) {
    if (pattern.test(text)) {
      return {
        passed: true,
        modified_text: text,
        threat_level: 1,
        reason: 'profanity',
      };
    }
  }

  return {
    passed: true,
    modified_text: text,
    threat_level: 0,
  };
}

// Cleanup old entries periodically
export function cleanupRapidFireMap(): void {
  const cutoff = Date.now() - 60000;
  for (const [key, time] of lastMessageTime) {
    if (time < cutoff) lastMessageTime.delete(key);
  }
}
