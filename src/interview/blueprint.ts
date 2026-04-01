import { z } from 'zod';

// ── Round 1: Discovery ───────────────────────────────────

export const DiscoverySchema = z.object({
  owner_name: z.string().min(1).describe('Prospect first name'),
  owner_about: z.string().min(1).describe('What they shared about themselves — role, work, life context'),
  domain: z.string().min(1).describe('Where the assistant lives — work, fitness, research, creative, personal, generalist, etc.'),
  purpose: z.string().min(1).describe('What they want help with, in their own words'),
});

// ── Round 2: Agent Identity ──────────────────────────────

export const IdentitySchema = z.object({
  agent_name: z.string().min(1).describe('The chosen name for the agent'),
  gender: z.enum(['male', 'female', 'neutral']).describe('Agent gender/presentation'),
  personality_summary: z.string().min(1).describe('Rich free-form personality description — for DNA seeding and proposal narrative'),
  personality_traits: z.array(z.string()).min(1).describe('Key personality tags: direct, warm, witty, patient, etc.'),
  communication_style: z.string().min(1).describe('How the agent talks — tone, register, energy'),
  archetype: z.string().nullable().describe('Character reference if given: Pepper Potts energy, JARVIS-like, tough coach, etc.'),
  visual_description: z.string().min(1).describe('Physical description for portrait generation — age impression, style, vibe'),
  primary_channel: z.string().min(1).describe('How owner will talk to agent: WhatsApp, Telegram, etc.'),
  languages: z.array(z.string()).min(1).describe('Languages the agent should speak'),
});

// ── Round 3: Confirmed ──────────────────────────────────

export const ConfirmedSchema = z.object({
  playback_text: z.string().min(1).describe('The narrative playback Maren delivered, in prospect\'s language'),
  approved: z.literal(true).describe('Prospect confirmed the playback'),
  adjustments: z.array(z.string()).describe('Any adjustments made after playback'),
});

// ── Full Blueprint ────────────────────────────────────────

export const BlueprintSchema = z.object({
  discovery: DiscoverySchema,
  identity: IdentitySchema.optional(),
  confirmed: ConfirmedSchema.optional(),
});

export type Discovery = z.infer<typeof DiscoverySchema>;
export type Identity = z.infer<typeof IdentitySchema>;
export type Confirmed = z.infer<typeof ConfirmedSchema>;
export type Blueprint = z.infer<typeof BlueprintSchema>;

// ── Progressive Validators ────────────────────────────────
// Validate that the required fields are present for a given round.

const Round1Schema = z.object({
  discovery: DiscoverySchema,
  identity: z.undefined().optional(),
  confirmed: z.undefined().optional(),
});

const Round2Schema = z.object({
  discovery: DiscoverySchema,
  identity: IdentitySchema,
  confirmed: z.undefined().optional(),
});

const Round3Schema = z.object({
  discovery: DiscoverySchema,
  identity: IdentitySchema,
  confirmed: ConfirmedSchema,
});

const roundSchemas = [Round1Schema, Round2Schema, Round3Schema] as const;

/**
 * Validate a Blueprint at a specific round level.
 * Round 1: only discovery required. Round 3: all sections required.
 * Returns { success, data?, error? }.
 */
export function validateAtRound(data: unknown, round: 1 | 2 | 3) {
  return roundSchemas[round - 1].safeParse(data);
}
