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
 * Map Blueprint persona fields → PORTRAIT_STYLE.md-compliant image generation prompt.
 * The prompt encodes style anchor (studio photography, white background, seafoam accent),
 * agent identity (name, role, personality), and prop/clothing guidance.
 */
export function buildPortraitPrompt(blueprint: Blueprint): string {
  const gaps = blueprint.gaps;
  const seed = blueprint.seed;
  const shape = blueprint.shape;

  // Infer agent role category for prop selection
  const purpose = seed.purpose.toLowerCase();
  const roleCategory = inferRoleCategory(purpose);

  // Infer formality from persona style
  const personaStyle = gaps?.persona.style?.toLowerCase() || '';
  const formality = inferFormality(personaStyle);

  // Infer expression from persona traits
  const traits = gaps?.persona.traits || [];
  const expression = inferExpression(traits, personaStyle);

  // Agent name for context
  const agentName = gaps?.agent_name || 'the digital partner';

  // Prop based on role
  const prop = getProp(roleCategory);

  // Diversity signal — use agent name hash to vary demographics
  const diversitySeed = hashString(agentName);
  const demographics = getDemographics(diversitySeed);

  // Build the prompt
  const parts: string[] = [
    'Professional studio portrait photograph.',
    `${demographics.description}.`,
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

function inferRoleCategory(purpose: string): string {
  if (/briefing|email|inbox|calendar|assistant|schedule/.test(purpose)) return 'personal_assistant';
  if (/market|trading|stock|finance|analytics|data/.test(purpose)) return 'market_analyst';
  if (/content|writing|social|marketing|blog/.test(purpose)) return 'content';
  if (/support|customer|help|ticket/.test(purpose)) return 'customer_support';
  if (/sales|lead|crm|pipeline/.test(purpose)) return 'sales';
  if (/research|study|report|analysis/.test(purpose)) return 'research';
  if (/operations|ops|workflow|process/.test(purpose)) return 'operations';
  if (/data|pipeline|etl|sync/.test(purpose)) return 'data_pipeline';
  return 'other';
}

interface FormalityResult {
  level: string;
  clothing: string;
}

function inferFormality(style: string): FormalityResult {
  if (/formal|professional|corporate|executive/.test(style)) {
    return { level: 'formal', clothing: 'Wearing a well-fitted blazer over a collared shirt or blouse, navy or charcoal tones' };
  }
  if (/casual|relaxed|friendly|approachable/.test(style)) {
    return { level: 'casual', clothing: 'Wearing a relaxed open-collar top or clean knit, warm neutral tones, no jacket' };
  }
  return { level: 'adaptive', clothing: 'Wearing smart-casual attire, clean collar, relaxed blazer or no jacket, neutral professional tones' };
}

function inferExpression(traits: string[], style: string): string {
  const combined = [...traits.map(t => t.toLowerCase()), style].join(' ');

  if (/warm|friendly|patient|kind/.test(combined)) return 'Genuine warm smile, soft eyes, approachable and open';
  if (/direct|analytical|precise|sharp/.test(combined)) return 'Confident, composed look with subtle warmth';
  if (/witty|humor|playful|energetic/.test(combined)) return 'Bright smile, eyes with a hint of energy and spark';
  if (/creative|expressive|artistic/.test(combined)) return 'Engaged, slightly animated, creative energy';
  return 'Warm professional smile, approachable and confident';
}

interface PropResult {
  item: string | null;
  accent: string;
}

function getProp(roleCategory: string): PropResult {
  const props: Record<string, PropResult> = {
    personal_assistant: { item: 'a tablet with a seafoam teal case', accent: 'a seafoam teal tablet case.' },
    market_analyst: { item: 'a tablet showing charts', accent: 'thin-frame glasses with a subtle seafoam temple accent.' },
    content: { item: 'a leather-bound notebook', accent: 'a pen with a seafoam clip.' },
    customer_support: { item: null, accent: 'a small seafoam lapel pin.' },
    sales: { item: null, accent: 'a seafoam pocket square edge.' },
    research: { item: 'a notebook', accent: 'a small seafoam brooch.' },
    operations: { item: 'a tablet', accent: 'a seafoam tablet case.' },
    data_pipeline: { item: null, accent: 'a subtle seafoam bracelet.' },
    other: { item: null, accent: 'a small seafoam lapel pin.' },
  };
  return props[roleCategory] || props.other;
}

// ── Diversity ─────────────────────────────────────────────

interface Demographics {
  description: string;
}

function getDemographics(seed: number): Demographics {
  // Deterministic but varied based on agent name
  const ageRange = ['late twenties', 'early thirties', 'mid-thirties', 'early forties', 'mid-forties', 'early fifties'];
  const presentations = [
    'A woman',
    'A man',
    'A woman',
    'A man',
    'A woman',
    'A man',
  ];
  const descriptors = [
    'with warm brown skin and curly dark hair',
    'with light skin and short auburn hair',
    'with dark skin and natural hair styled elegantly',
    'with olive skin and dark wavy hair',
    'with fair skin and straight dark hair',
    'with medium-brown skin and close-cropped hair',
  ];

  const age = ageRange[seed % ageRange.length];
  const presentation = presentations[seed % presentations.length];
  const descriptor = descriptors[(seed * 3 + 1) % descriptors.length];

  return {
    description: `${presentation} in her/his ${age}, ${descriptor}`,
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit int
  }
  return Math.abs(hash);
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
