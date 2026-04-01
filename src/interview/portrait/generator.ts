import type { Blueprint } from '../blueprint.js';

// ── Provider Interface ────────────────────────────────────

export interface PortraitResult {
  imageBuffer: Buffer;
  provider: string;
  model: string;
  prompt: string;
}

export interface PortraitProvider {
  name: string;
  generate(prompt: string): Promise<PortraitResult>;
}

// ── Prompt Builder ────────────────────────────────────────

/**
 * Map Blueprint identity fields → PORTRAIT_STYLE.md-compliant image generation prompt.
 * The prompt encodes style anchor (studio photography, white background, seafoam accent),
 * agent identity (name, gender, personality), and prop/clothing guidance.
 */
export function buildPortraitPrompt(blueprint: Blueprint): string {
  const identity = blueprint.identity;
  const discovery = blueprint.discovery;

  // Use visual_description from identity if available, otherwise build from context
  const visualDesc = identity?.visual_description || 'Professional, approachable, mid-thirties';
  const gender = identity?.gender || 'neutral';
  const agentName = identity?.agent_name || 'the digital partner';

  // Infer role category from purpose for prop selection
  const purpose = discovery.purpose.toLowerCase();
  const roleCategory = inferRoleCategory(purpose, discovery.domain);

  // Infer formality from personality
  const communicationStyle = identity?.communication_style?.toLowerCase() || '';
  const personalitySummary = identity?.personality_summary?.toLowerCase() || '';
  const formality = inferFormality(communicationStyle, personalitySummary);

  // Infer expression from personality traits
  const traits = identity?.personality_traits || [];
  const expression = inferExpression(traits, personalitySummary);

  // Gender-appropriate pronoun for demographics description
  const genderDesc = gender === 'male' ? 'A man' : gender === 'female' ? 'A woman' : 'A person';

  // Prop based on domain/role
  const prop = getProp(roleCategory);

  // Build the prompt
  const parts: string[] = [
    'Professional studio portrait photograph.',
    `${genderDesc}. ${visualDesc}.`,
    `${expression} expression, eyes directed at the viewer.`,
    `${formality.clothing}.`,
    'Clean white studio background, no objects or environments.',
    'Warm, soft studio lighting with natural color temperature.',
    'Upper-body framing, slight 3/4 body angle.',
    'One small seafoam (#00FFBF) accent detail — ',
    prop.accent,
    'Photorealistic, studio quality, professional headshot style.',
    'Sharp detail in face, hair, and clothing texture.',
    'Square 1:1 composition, 1024x1024 pixels.',
  ];

  if (prop.item) {
    parts.push(`Holding ${prop.item}.`);
  }

  return parts.join(' ');
}

// ── Inference Helpers ─────────────────────────────────────

function inferRoleCategory(purpose: string, domain: string): string {
  const combined = `${purpose} ${domain}`.toLowerCase();
  // Check specific domains first, then broader categories
  if (/fitness|training|workout|gym|health|diet|nutrition/.test(combined)) return 'fitness';
  if (/market|trading|stock|finance|analytics/.test(combined)) return 'market_analyst';
  if (/content|writing|social|marketing|blog|creative/.test(combined)) return 'content';
  if (/research|study|report|learning/.test(combined)) return 'research';
  if (/support|customer|ticket/.test(combined)) return 'customer_support';
  if (/sales|lead|crm|pipeline/.test(combined)) return 'sales';
  if (/briefing|email|inbox|calendar|assistant|schedule|work/.test(combined)) return 'personal_assistant';
  return 'other';
}

interface FormalityResult {
  level: string;
  clothing: string;
}

function inferFormality(communicationStyle: string, personalitySummary: string): FormalityResult {
  const combined = `${communicationStyle} ${personalitySummary}`;
  if (/formal|professional|corporate|executive|polished/.test(combined)) {
    return { level: 'formal', clothing: 'Wearing a well-fitted blazer over a collared shirt or blouse, navy or charcoal tones' };
  }
  if (/casual|relaxed|friendly|sporty|laid-back/.test(combined)) {
    return { level: 'casual', clothing: 'Wearing a relaxed open-collar top or clean knit, warm neutral tones, no jacket' };
  }
  if (/athletic|coach|trainer|fitness/.test(combined)) {
    return { level: 'athletic', clothing: 'Wearing a clean, fitted athletic top or sport zip-up, dark tones' };
  }
  return { level: 'adaptive', clothing: 'Wearing smart-casual attire, clean collar, relaxed blazer or no jacket, neutral professional tones' };
}

function inferExpression(traits: string[], personalitySummary: string): string {
  const combined = [...traits.map(t => t.toLowerCase()), personalitySummary].join(' ');

  if (/warm|friendly|patient|kind|gentle/.test(combined)) return 'Genuine warm smile, soft eyes, approachable and open';
  if (/direct|analytical|precise|sharp|no-nonsense/.test(combined)) return 'Confident, composed look with subtle warmth';
  if (/witty|humor|playful|energetic|fun/.test(combined)) return 'Bright smile, eyes with a hint of energy and spark';
  if (/tough|coach|demanding|competitive/.test(combined)) return 'Strong, determined look with confident warmth';
  if (/creative|expressive|artistic/.test(combined)) return 'Engaged, slightly animated, creative energy';
  return 'Warm professional smile, approachable and confident';
}

interface PropResult {
  item: string | null;
  accent: string;
}

function getProp(roleCategory: string): PropResult {
  const props: Record<string, PropResult> = {
    fitness: { item: null, accent: 'a seafoam sport watch or fitness band.' },
    personal_assistant: { item: 'a tablet with a seafoam teal case', accent: 'a seafoam teal tablet case.' },
    market_analyst: { item: 'a tablet showing charts', accent: 'thin-frame glasses with a subtle seafoam temple accent.' },
    content: { item: 'a leather-bound notebook', accent: 'a pen with a seafoam clip.' },
    customer_support: { item: null, accent: 'a small seafoam lapel pin.' },
    sales: { item: null, accent: 'a seafoam pocket square edge.' },
    research: { item: 'a notebook', accent: 'a small seafoam brooch.' },
    other: { item: null, accent: 'a small seafoam lapel pin.' },
  };
  return props[roleCategory] || props.other;
}

// ── Providers ─────────────────────────────────────────────

/**
 * Google Imagen provider (via @google/genai SDK).
 * Uses Imagen 3 or Nano Banana 2.0 model.
 */
export class GoogleImagenProvider implements PortraitProvider {
  name = 'google-imagen';
  private model: string;

  constructor(model = 'imagen-3.0-generate-002') {
    this.model = model;
  }

  async generate(prompt: string): Promise<PortraitResult> {
    // Dynamic import to avoid loading Google SDK if not used
    const { GoogleGenAI } = await import('@google/genai');
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const { getConfig } = await import('../../config.js');

    const config = getConfig();
    let apiKey: string;
    try {
      apiKey = readFileSync(resolve(config.credentials_path, 'gemini_api_key'), 'utf-8').trim();
    } catch {
      apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) throw new Error('Gemini API key not found');
    }

    const client = new GoogleGenAI({ apiKey });

    const response = await client.models.generateImages({
      model: this.model,
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
      },
    });

    const image = response.generatedImages?.[0];
    if (!image?.image?.imageBytes) {
      throw new Error('No image generated — safety filter may have blocked the request');
    }

    const imageBuffer = Buffer.from(image.image.imageBytes, 'base64');

    return {
      imageBuffer,
      provider: this.name,
      model: this.model,
      prompt,
    };
  }
}

/**
 * Generate a portrait for an agent based on its Blueprint.
 * Tries the primary provider first, falls back to alternatives.
 */
export async function generatePortrait(
  blueprint: Blueprint,
  provider?: PortraitProvider,
): Promise<PortraitResult> {
  const prompt = buildPortraitPrompt(blueprint);
  const selectedProvider = provider || new GoogleImagenProvider();

  console.log(`[portrait] Generating with ${selectedProvider.name}...`);
  console.log(`[portrait] Prompt: ${prompt.slice(0, 150)}...`);

  return selectedProvider.generate(prompt);
}
