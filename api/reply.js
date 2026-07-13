const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const X_OEMBED_URL = 'https://publish.x.com/oembed';
const OEMBED_TIMEOUT_MS = 4000;
const OUTPUT_ONLY_INSTRUCTION =
  'Return only the written reply. Do not include prefacing text, constraints, labels, explanations, markdown, quotes, or alternatives.';
const USER_OUTPUT_ONLY_INSTRUCTION = 'Only return the reply text.';

function json(res, statusCode, payload) {
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(payload);
  }
  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
  return res.end(JSON.stringify(payload));
}

function readBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function getVariant() {
  const premium = Math.random() < 0.08;
  if (premium) {
    return {
      premium,
      model: 'anthropic/claude-3.5-haiku',
      maxTokens: 150,
      temperature: 0.8,
      systemPrompt:
        `You are a sharp, insightful analyst. Write a genuinely thoughtful, well-reasoned reply about Solana or crypto. Be concise (max 250 chars), informed, and original. Sound like someone who actually knows what you are talking about. No cringe, no buzzword spam. Earnest and smart. ${OUTPUT_ONLY_INSTRUCTION}`,
      defaultPrompt: `Write a thoughtful, insightful reply about Solana. ${USER_OUTPUT_ONLY_INSTRUCTION}`,
      tweetPrompt: (tweetUrl, tweetContext) =>
        `Write a thoughtful reply to this tweet${tweetUrl ? ` at ${tweetUrl}` : ''}. Make it insightful.${tweetContext ? `\n\nTweet context:\n${tweetContext}` : ''}\n\n${USER_OUTPUT_ONLY_INSTRUCTION}`,
    };
  }
  return {
    premium,
    model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
    maxTokens: 100,
    temperature: 1.1,
    systemPrompt:
      `You are a terrible, cringey AI reply bot obsessed with Solana. Generate replies with: overly confident crypto-bro tone, Solana/crypto buzzwords ("SVM", "mainnet", "validator", "SOL", "on-chain", "permissionless", "RPC", "block", "pump.fun", "Jupiter"), barely related to the tweet, embarrassing "reply guy" energy, max 250 characters, 1-2 sentences, satirical, non-sequitur, absurd. No hashtags. Never helpful or sincere. ${OUTPUT_ONLY_INSTRUCTION}`,
    defaultPrompt: `Generate a terrible Solana reply. ${USER_OUTPUT_ONLY_INSTRUCTION}`,
    tweetPrompt: (tweetUrl, tweetContext) =>
      `Generate a terrible reply to this tweet${tweetUrl ? ` at ${tweetUrl}` : ''}.${tweetContext ? `\n\nTweet context:\n${tweetContext}` : ''}\n\n${USER_OUTPUT_ONLY_INSTRUCTION}`,
  };
}

function decodeHtml(text) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(text || '').replace(/&(#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (entity, token, decimal, hex) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return named[token.toLowerCase()] ?? entity;
  });
}

function cleanPlainText(text) {
  return decodeHtml(String(text || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTweetTextFromEmbed(html) {
  const paragraph = String(html || '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return cleanPlainText(paragraph ? paragraph[1] : html);
}

function getTweetLookupUrl(tweetUrl, tweetId) {
  if (tweetUrl) {
    try {
      const url = new URL(tweetUrl);
      const host = url.hostname.replace(/^www\./, '');
      if ((host === 'x.com' || host === 'twitter.com') && /\/(?:i\/)?status\/\d+/.test(url.pathname)) {
        return tweetUrl;
      }
    } catch {}
  }
  if (/^\d{5,}$/.test(tweetId || '')) {
    return `https://x.com/i/status/${tweetId}`;
  }
  return '';
}

function formatTweetContext(oembed) {
  const author = cleanPlainText(oembed?.author_name);
  const tweetText = extractTweetTextFromEmbed(oembed?.html);
  if (!author && !tweetText) return '';

  return [
    author ? `Author: ${author}` : '',
    tweetText ? `Tweet: ${tweetText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function fetchTweetContext(tweetUrl) {
  if (!tweetUrl) return '';

  const url = new URL(X_OEMBED_URL);
  url.searchParams.set('url', tweetUrl);
  url.searchParams.set('omit_script', '1');
  url.searchParams.set('dnt', '1');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return '';
    const data = await response.json().catch(() => ({}));
    return formatTweetContext(data);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function cleanReply(text) {
  return String(text || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .slice(0, 280);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json(res, 503, { error: 'missing_api_key' });
  }

  const body = readBody(req.body);
  const tweetUrl = typeof body.tweetUrl === 'string' ? body.tweetUrl.trim() : '';
  const tweetId = typeof body.tweetId === 'string' ? body.tweetId.trim() : '';
  const variant = getVariant();
  const tweetLookupUrl = getTweetLookupUrl(tweetUrl, tweetId);
  const tweetContext = await fetchTweetContext(tweetLookupUrl);
  const promptTweetRef = tweetLookupUrl || tweetUrl || tweetId;
  const userPrompt = tweetUrl || tweetId ? variant.tweetPrompt(promptTweetRef, tweetContext) : variant.defaultPrompt;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://solanareplygenerator.lol',
        'X-Title': 'Solana Reply Generator',
      },
      body: JSON.stringify({
        model: variant.model,
        messages: [
          { role: 'system', content: variant.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: variant.maxTokens,
        temperature: variant.temperature,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const text = cleanReply(data.choices?.[0]?.message?.content);

    if (!response.ok || data.error || !text) {
      return json(res, 502, {
        error: 'model_unavailable',
        detail: data.error?.message || response.statusText || 'empty_reply',
      });
    }

    return json(res, 200, {
      text,
      source: 'model',
      premium: variant.premium,
      model: variant.model,
    });
  } catch (error) {
    return json(res, 502, {
      error: 'model_unavailable',
      detail: error.name === 'AbortError' ? 'timeout' : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports._private = {
  cleanReply,
  cleanPlainText,
  extractTweetTextFromEmbed,
  fetchTweetContext,
  formatTweetContext,
  getTweetLookupUrl,
  getVariant,
  readBody,
};
