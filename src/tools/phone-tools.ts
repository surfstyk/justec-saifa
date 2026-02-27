import type { Session, StructuredMessage } from '../types.js';
import type { ToolCallResult } from './calendar-tools.js';

export function handleRequestPhone(session: Session): ToolCallResult {
  const lang = session.visitor_info.language || session.language || 'en';

  const structured: StructuredMessage = {
    type: 'phone_request',
    payload: {
      language: lang,
    },
  };

  return {
    result: {
      requested: true,
      message: 'Phone number input has been shown to the visitor. Wait for them to submit it.',
    },
    structured,
  };
}
