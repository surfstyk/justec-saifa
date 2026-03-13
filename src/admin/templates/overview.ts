import { getSessionStore, getActiveSessionCount, getQueueLength } from '../../session/store-memory.js';
import { getConfig } from '../../config.js';
import { getDailyStats } from '../stats.js';
import { getSecurityEventsToday } from '../queries.js';
import { layout, formatDuration } from './layout.js';

export function renderOverview(): string {
  const config = getConfig();
  const store = getSessionStore();
  const activeCount = getActiveSessionCount();
  const queueLength = getQueueLength();
  const stats = getDailyStats();
  const securityEventsDb = getSecurityEventsToday();

  // Per-tier counts and oldest session
  let lobbyCount = 0;
  let meetingRoomCount = 0;
  let oldestActivity = Date.now();

  for (const session of store.values()) {
    if (session.status !== 'active') continue;
    if (session.tier === 'lobby') lobbyCount++;
    else meetingRoomCount++;
    if (session.last_activity < oldestActivity) {
      oldestActivity = session.last_activity;
    }
  }

  const oldestAge = activeCount > 0 ? formatDuration(Date.now() - oldestActivity) : '—';
  const uptimeMs = Date.now() - processStartTime;

  const body = `
    <span class="auto-refresh">Auto-refreshes every 30s</span>
    <meta http-equiv="refresh" content="30">

    <h2>Active Sessions</h2>
    <div class="card-grid">
      <div class="card">
        <div class="card-label">Active</div>
        <div class="card-value">${activeCount}</div>
        <div class="card-detail">of ${config.rate_limits.max_concurrent_sessions} max</div>
      </div>
      <div class="card">
        <div class="card-label">Lobby</div>
        <div class="card-value">${lobbyCount}</div>
      </div>
      <div class="card">
        <div class="card-label">Meeting Room</div>
        <div class="card-value">${meetingRoomCount}</div>
      </div>
      <div class="card">
        <div class="card-label">Queue</div>
        <div class="card-value">${queueLength}</div>
      </div>
      <div class="card">
        <div class="card-label">Oldest Session</div>
        <div class="card-value">${oldestAge}</div>
      </div>
    </div>

    <h2>Today's Counters</h2>
    <div class="card-grid">
      <div class="card">
        <div class="card-label">Sessions Created</div>
        <div class="card-value">${stats.sessions_created}</div>
      </div>
      <div class="card">
        <div class="card-label">Messages</div>
        <div class="card-value">${stats.messages_processed}</div>
      </div>
      <div class="card">
        <div class="card-label">Escalations</div>
        <div class="card-value">${stats.escalations}</div>
      </div>
      <div class="card">
        <div class="card-label">Bookings</div>
        <div class="card-value">${stats.bookings}</div>
      </div>
      <div class="card">
        <div class="card-label">Security Events</div>
        <div class="card-value">${securityEventsDb + stats.security_events}</div>
      </div>
      <div class="card">
        <div class="card-label">LLM Errors</div>
        <div class="card-value">${stats.llm_errors}</div>
      </div>
    </div>

    <h2>System</h2>
    <div class="card-grid">
      <div class="card">
        <div class="card-label">Uptime</div>
        <div class="card-value">${formatDuration(uptimeMs)}</div>
      </div>
      <div class="card">
        <div class="card-label">Node.js</div>
        <div class="card-value" style="font-size:18px">${process.version}</div>
      </div>
      <div class="card">
        <div class="card-label">LLM Model</div>
        <div class="card-value" style="font-size:14px">${config.llm.lobby.model}</div>
      </div>
      <div class="card">
        <div class="card-label">Config</div>
        <div class="card-value" style="font-size:14px">${config.client.name}</div>
      </div>
      <div class="card">
        <div class="card-label">Version</div>
        <div class="card-value" style="font-size:18px">2.1.0</div>
      </div>
    </div>
  `;

  return layout('Overview', '/admin/', body);
}

const processStartTime = Date.now();
