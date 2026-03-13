import { getConfig } from '../../config.js';
import { layout, escapeHtml } from './layout.js';

export function renderConfig(): string {
  const config = getConfig();

  const body = `
    ${section('Client', {
      'Company': config.client.company,
      'Company (PT)': config.client.company_pt,
      'Owner': config.client.owner,
      'Timezone': config.client.timezone,
      'Languages': config.client.languages.join(', '),
      'Phone': config.client.phone,
      'Website': config.client.website,
      'Location': config.client.location,
      'CORS Origins': config.client.cors_origins.join(', '),
    })}

    ${section('Persona', {
      'Name': config.persona.name,
      'Role': config.persona.assistant_role,
      'System Name': config.persona.system_name,
      'Contact Channel': config.persona.contact_channel,
      'Prompts Dir': config.persona.prompts_dir,
    })}

    ${section('LLM — Lobby', {
      'Provider': config.llm.lobby.provider,
      'Model': config.llm.lobby.model,
      'Max Tokens': String(config.llm.lobby.max_tokens),
      'Temperature': String(config.llm.lobby.temperature ?? 'default'),
    })}

    ${section('LLM — Meeting Room', {
      'Provider': config.llm.meeting_room.provider,
      'Model': config.llm.meeting_room.model,
      'Max Tokens': String(config.llm.meeting_room.max_tokens),
      'Temperature': String(config.llm.meeting_room.temperature ?? 'default'),
    })}

    ${section('Scoring', {
      'Weight: Explicit': String(config.scoring.weights.explicit),
      'Weight: Behavioral': String(config.scoring.weights.behavioral),
      'Weight: Fit': String(config.scoring.weights.fit),
      'Threshold: Qualified': String(config.scoring.thresholds.qualified),
      'Threshold: Warm': String(config.scoring.thresholds.warm),
      'Threshold: Cold': String(config.scoring.thresholds.cold),
    })}

    ${section('Budgets (tokens)', {
      'Anonymous': config.budgets.anonymous.toLocaleString(),
      'Engaged': config.budgets.engaged.toLocaleString(),
      'Qualified': config.budgets.qualified.toLocaleString(),
      'Post-Booking': config.budgets.post_booking.toLocaleString(),
    })}

    ${section('Rate Limits', {
      'Messages/Session': String(config.rate_limits.messages_per_session),
      'Messages/IP/Hour': String(config.rate_limits.messages_per_ip_per_hour),
      'Max Concurrent': String(config.rate_limits.max_concurrent_sessions),
      'Session TTL (min)': String(config.rate_limits.session_ttl_minutes),
    })}

    ${section('Calendar', {
      'Working Days': config.calendar.working_hours.days.map(d => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', '),
      'Working Hours': `${config.calendar.working_hours.start} – ${config.calendar.working_hours.end}`,
      'Timezone': config.calendar.working_hours.timezone,
      'Slot Duration (min)': String(config.calendar.slot_duration_minutes),
      'Lookahead (days)': String(config.calendar.lookahead_days),
      'Buffer (min)': String(config.calendar.buffer_minutes),
      'Max Offered Slots': String(config.calendar.max_offered_slots),
    })}

    ${section('Payment', {
      'Amount': config.payment.deposit_display,
      'Currency': config.payment.currency.toUpperCase(),
      'Providers': config.payment.providers.join(', '),
      'Deposit Credited': config.payment.deposit_credited ? 'Yes' : 'No',
      'Product': config.payment.product_name,
    })}

    ${section('Credentials', {
      'Path': config.credentials_path,
      'Values': '[REDACTED]',
    })}

    ${section('System', {
      'Database Path': config.dev_mode ? ':memory:' : config.database_path,
      'Dev Mode': String(config.dev_mode),
      'Port': String(config.port),
      'Turnstile': config.turnstile_secret ? '[CONFIGURED]' : 'Not set',
    })}
  `;

  return layout('Config', '/admin/config', body);
}

function section(title: string, rows: Record<string, string>): string {
  const rowHtml = Object.entries(rows).map(([key, value]) =>
    `<div class="config-row">
      <span class="config-key">${escapeHtml(key)}</span>
      <span class="config-val">${escapeHtml(value)}</span>
    </div>`
  ).join('');

  return `<h2>${escapeHtml(title)}</h2><div class="config-section">${rowHtml}</div>`;
}
