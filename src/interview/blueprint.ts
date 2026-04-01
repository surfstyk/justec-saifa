import { z } from 'zod';

// ── Round 1: The Seed ─────────────────────────────────────

export const SeedSchema = z.object({
  domain: z.string().min(1).describe('Industry or business area'),
  purpose: z.string().min(1).describe('What the agent should do — one-sentence core purpose'),
  identity: z.object({
    prospect_name: z.string().nullable().describe('Prospect name if captured'),
    company: z.string().nullable().describe('Company name if captured'),
    role: z.string().nullable().describe('Role or title if captured'),
    industry: z.string().nullable().describe('Industry if captured'),
  }),
  complexity_signal: z.enum(['simple', 'moderate', 'complex']).describe('Rough complexity assessment'),
  raw_needs: z.string().describe('Prospect\'s own words describing what they need'),
});

// ── Round 2: The Shape ────────────────────────────────────

export const ShapeSchema = z.object({
  inputs: z.array(z.object({
    source: z.string().min(1),
    description: z.string().min(1),
  })).min(1).describe('Data sources the agent needs'),

  logic: z.object({
    autonomous_actions: z.array(z.string()).describe('What the agent decides on its own'),
    approval_required: z.array(z.string()).describe('What needs human confirmation'),
  }),

  output: z.object({
    channels: z.array(z.string()).min(1).describe('Delivery channels (Telegram, email, Slack, etc.)'),
    audience: z.string().describe('Who sees the output (prospect, their team, customers)'),
  }),

  rhythm: z.object({
    schedule: z.string().min(1).describe('Frequency and timing (daily at 06:00, real-time, etc.)'),
    specific_times: z.array(z.string()).optional().describe('Specific times mentioned'),
  }),

  language: z.object({
    primary: z.string().min(1).describe('Primary language'),
    additional: z.array(z.string()).optional().describe('Additional languages needed'),
  }),

  budget: z.object({
    ceiling: z.string().nullable().describe('Monthly budget ceiling if stated'),
    sensitivity: z.enum(['price_sensitive', 'value_focused', 'not_discussed']),
  }),

  existing_assets: z.array(z.string()).optional().describe('APIs, servers, tools already in place'),
});

// ── Round 3: The Gaps ─────────────────────────────────────

export const GapsSchema = z.object({
  failure_handling: z.object({
    strategy: z.string().min(1).describe('What happens when things go wrong'),
    escalation: z.string().describe('When the agent should escalate to the human'),
  }),

  safety_rails: z.array(z.object({
    rule: z.string().min(1),
    rationale: z.string().optional(),
  })).describe('Things the agent must never do or must always check'),

  persona: z.object({
    style: z.string().describe('Communication style (professional, casual, terse, friendly)'),
    traits: z.array(z.string()).optional().describe('Personality traits mentioned'),
  }),

  agent_name: z.string().min(1).describe('The chosen name for the agent'),

  additional_needs: z.array(z.string()).optional().describe('Anything the prospect raised that was not covered'),
});

// ── Round 4: Confirmed ────────────────────────────────────

export const ConfirmedSchema = z.object({
  playback_text: z.string().min(1).describe('The narrative playback Maren delivered, in prospect\'s language'),
  approved: z.literal(true).describe('Prospect confirmed the playback'),
  adjustments: z.array(z.string()).describe('Any adjustments made after playback'),
});

// ── Full Blueprint ────────────────────────────────────────

export const BlueprintSchema = z.object({
  seed: SeedSchema,
  shape: ShapeSchema.optional(),
  gaps: GapsSchema.optional(),
  confirmed: ConfirmedSchema.optional(),
});

export type Seed = z.infer<typeof SeedSchema>;
export type Shape = z.infer<typeof ShapeSchema>;
export type Gaps = z.infer<typeof GapsSchema>;
export type Confirmed = z.infer<typeof ConfirmedSchema>;
export type Blueprint = z.infer<typeof BlueprintSchema>;

// ── Progressive Validators ────────────────────────────────
// Validate that the required fields are present for a given round.

const Round1Schema = z.object({
  seed: SeedSchema,
  shape: z.undefined().optional(),
  gaps: z.undefined().optional(),
  confirmed: z.undefined().optional(),
});

const Round2Schema = z.object({
  seed: SeedSchema,
  shape: ShapeSchema,
  gaps: z.undefined().optional(),
  confirmed: z.undefined().optional(),
});

const Round3Schema = z.object({
  seed: SeedSchema,
  shape: ShapeSchema,
  gaps: GapsSchema,
  confirmed: z.undefined().optional(),
});

const Round4Schema = z.object({
  seed: SeedSchema,
  shape: ShapeSchema,
  gaps: GapsSchema,
  confirmed: ConfirmedSchema,
});

const roundSchemas = [Round1Schema, Round2Schema, Round3Schema, Round4Schema] as const;

/**
 * Validate a Blueprint at a specific round level.
 * Round 1: only seed required. Round 4: all sections required.
 * Returns { success, data?, error? }.
 */
export function validateAtRound(data: unknown, round: 1 | 2 | 3 | 4) {
  return roundSchemas[round - 1].safeParse(data);
}
