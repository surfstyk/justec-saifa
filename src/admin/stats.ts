// In-memory daily stats counter — resets at midnight, does not survive restarts

interface DailyStats {
  date: string; // YYYY-MM-DD
  sessions_created: number;
  messages_processed: number;
  escalations: number;
  bookings: number;
  security_events: number;
  llm_errors: number;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

let stats: DailyStats = {
  date: todayKey(),
  sessions_created: 0,
  messages_processed: 0,
  escalations: 0,
  bookings: 0,
  security_events: 0,
  llm_errors: 0,
};

function ensureCurrentDay(): void {
  const today = todayKey();
  if (stats.date !== today) {
    stats = {
      date: today,
      sessions_created: 0,
      messages_processed: 0,
      escalations: 0,
      bookings: 0,
      security_events: 0,
      llm_errors: 0,
    };
  }
}

export function recordSessionCreated(): void {
  ensureCurrentDay();
  stats.sessions_created++;
}

export function recordMessage(): void {
  ensureCurrentDay();
  stats.messages_processed++;
}

export function recordEscalation(): void {
  ensureCurrentDay();
  stats.escalations++;
}

export function recordBooking(): void {
  ensureCurrentDay();
  stats.bookings++;
}

export function recordSecurityEvent(): void {
  ensureCurrentDay();
  stats.security_events++;
}

export function recordLLMError(): void {
  ensureCurrentDay();
  stats.llm_errors++;
}

export function getDailyStats(): Readonly<DailyStats> {
  ensureCurrentDay();
  return { ...stats };
}
