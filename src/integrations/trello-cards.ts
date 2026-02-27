import { createCard, moveCard, updateCard } from './trello.js';
import type { Session } from '../types.js';

function formatDescription(session: Session): string {
  const vi = session.visitor_info;
  const lines = [
    `Score: ${session.score_composite}/100 (behavioral: ${session.score_behavioral}, explicit: ${session.score_explicit}, fit: ${session.score_fit})`,
    `Classification: ${session.classification}`,
    `Language: ${(vi.language || session.language || 'en').toUpperCase()}`,
  ];

  if (vi.role) lines.push(`Role: ${vi.role}`);
  if (vi.company_size) lines.push(`Company Size: ${vi.company_size}`);
  if (vi.industry) lines.push(`Industry: ${vi.industry}`);
  lines.push(`Session: ${session.id}`);

  return lines.join('\n');
}

export async function createLeadCard(session: Session): Promise<void> {
  const vi = session.visitor_info;
  const name = vi.name || 'Website Visitor';
  const company = vi.company || 'Unknown';
  const title = `${name} — ${company}`;
  const desc = formatDescription(session);

  const cardId = await createCard('meeting_room', title, desc);
  if (cardId) {
    session.trello_card_id = cardId;
    console.log(`[trello-cards] Created lead card ${cardId} for session ${session.id}`);
  }
}

export async function moveToPhoneCaptured(session: Session): Promise<void> {
  if (!session.trello_card_id) return;

  const vi = session.visitor_info;
  const phone = session.metadata?.phone as string | undefined;
  const fields: Record<string, string> = {
    name: `${vi.name || 'Website Visitor'} — ${vi.company || 'Unknown'}`,
    desc: formatDescription(session) + (phone ? `\nPhone: ${phone}` : ''),
  };
  await updateCard(session.trello_card_id, fields);

  const moved = await moveCard(session.trello_card_id, 'phone_captured');
  if (moved) {
    console.log(`[trello-cards] Moved card ${session.trello_card_id} to Phone Captured`);
  }
}

export async function moveToBooked(session: Session): Promise<void> {
  if (!session.trello_card_id) return;

  // Format booking time for display
  let bookingDisplay = session.booking_time || '';
  try {
    if (session.booking_time) {
      const dt = new Date(session.booking_time);
      bookingDisplay = dt.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Lisbon',
      }) + ' (Lisbon)';
    }
  } catch {
    // Use raw string if formatting fails
  }

  const vi = session.visitor_info;
  const fields: Record<string, string> = {
    name: `${vi.name || 'Website Visitor'} — ${vi.company || 'Unknown'}`,
    desc: formatDescription(session) + (session.metadata?.phone ? `\nPhone: ${session.metadata.phone}` : '') + `\nBooking: ${bookingDisplay}`,
  };

  // Set due date on the card
  if (session.booking_time) {
    fields.due = session.booking_time;
  }

  await updateCard(session.trello_card_id, fields);
  const moved = await moveCard(session.trello_card_id, 'booked');
  if (moved) {
    console.log(`[trello-cards] Moved card ${session.trello_card_id} to Booked`);
  }
}
