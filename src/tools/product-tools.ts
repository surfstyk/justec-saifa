import type { Session, StructuredMessage, ToolDefinition } from '../types.js';
import type { ToolCallResult } from './calendar-tools.js';

export const PRESENT_PRODUCT_TOOL: ToolDefinition = {
  name: 'present_product',
  description: 'Present a product from the portfolio to the visitor with a clickable link card. Use this for self-service products: "membermagix" (WordPress membership plugin) or "kongquant" (market intelligence). The card is displayed inline in the chat — do not repeat the URL in your text.',
  parameters: {
    type: 'object',
    properties: {
      product: {
        type: 'string',
        enum: ['membermagix', 'kongquant'],
        description: 'Which product to present.',
      },
    },
    required: ['product'],
  },
};

interface ProductLink {
  url: string;
  label: Record<string, string>;
  primary: boolean;
}

interface ProductDefinition {
  slug: string;
  links: ProductLink[];
}

const PRODUCTS: Record<string, ProductDefinition> = {
  membermagix: {
    slug: 'membermagix',
    links: [
      {
        url: 'https://membermagix.com/?utm_source=justec&utm_medium=chat&utm_campaign=referral&utm_content=product-link',
        label: {
          en: 'Visit MemberMagix',
          de: 'MemberMagix besuchen',
          pt: 'Visitar MemberMagix',
        },
        primary: true,
      },
    ],
  },
  kongquant: {
    slug: 'kongquant',
    links: [
      {
        url: 'https://kongquant.com/?utm_source=justec&utm_medium=chat&utm_campaign=referral&utm_content=product-link',
        label: {
          en: 'Visit KongQuant',
          de: 'KongQuant besuchen',
          pt: 'Visitar KongQuant',
        },
        primary: true,
      },
      {
        url: 'https://x.com/kongquant',
        label: {
          en: 'Follow on X',
          de: 'Auf X folgen',
          pt: 'Seguir no X',
        },
        primary: false,
      },
      {
        url: 'https://tiktok.com/@kongquant',
        label: {
          en: 'Follow on TikTok',
          de: 'Auf TikTok folgen',
          pt: 'Seguir no TikTok',
        },
        primary: false,
      },
    ],
  },
};

export function handlePresentProduct(
  session: Session,
  args: Record<string, unknown>,
): ToolCallResult {
  const productName = (args.product as string || '').toLowerCase();

  const product = PRODUCTS[productName];
  if (!product) {
    return {
      result: {
        error: true,
        message: `Unknown product: "${productName}". Valid options: ${Object.keys(PRODUCTS).join(', ')}`,
      },
    };
  }

  const lang = session.visitor_info.language || session.language || 'en';

  const structured: StructuredMessage = {
    type: 'product_link',
    payload: {
      product: product.slug,
      links: product.links,
      language: lang,
    },
  };

  return {
    result: {
      presented: true,
      product: product.slug,
      message: `Product link card for ${product.slug} has been shown to the visitor. Do not repeat the URLs in your text — the card handles that. Continue the conversation naturally.`,
    },
    structured,
  };
}
