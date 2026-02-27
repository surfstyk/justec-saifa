import { getConfig } from '../config.js';
import type { Session, StructuredMessage } from '../types.js';
import type { ToolCallResult } from './calendar-tools.js';

export function handleRequestPhone(session: Session): ToolCallResult {
  const config = getConfig();
  const lang = session.visitor_info.language || session.language || 'en';

  const prompts: Record<string, string> = {
    en: 'Please enter your phone number so we can reach you.',
    de: 'Bitte geben Sie Ihre Telefonnummer ein, damit wir Sie erreichen können.',
    pt: 'Por favor introduza o seu número de telefone para que possamos contactá-lo.',
  };

  const placeholders: Record<string, string> = {
    en: '+1 555 000 0000',
    de: '+49 170 0000000',
    pt: '+351 900 000 000',
  };

  const structured: StructuredMessage = {
    type: 'phone_request',
    payload: {
      language: lang,
      prompt: prompts[lang] || prompts.en,
      preferred_messenger: config.persona.contact_channel,
      placeholder: placeholders[lang] || placeholders.en,
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
