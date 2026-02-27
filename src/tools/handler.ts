import { handleCheckAvailability, handleBookAppointment } from './calendar-tools.js';
import { handleRequestPhone } from './phone-tools.js';
import { handleRequestPayment } from './payment-tools.js';
import { handleReportSignals } from './signal-tool.js';
import type { Session } from '../types.js';
import type { ToolCallResult } from './calendar-tools.js';

export type { ToolCallResult } from './calendar-tools.js';

export async function handleToolCall(
  session: Session,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  console.log(`[tools] Executing tool: ${toolName}`, JSON.stringify(args));

  switch (toolName) {
    case 'check_calendar_availability':
      return handleCheckAvailability(session, args);

    case 'book_appointment':
      return handleBookAppointment(session, args);

    case 'request_phone':
      return handleRequestPhone(session);

    case 'request_payment':
      return handleRequestPayment(session, args);

    case 'report_signals':
      return handleReportSignals(args);

    default:
      console.warn(`[tools] Unknown tool: ${toolName}`);
      return {
        result: { error: true, message: `Unknown tool: ${toolName}` },
      };
  }
}
