const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
        'You are a sharp, insightful analyst. Write a genuinely thoughtful, well-reasoned reply about Solana or crypto. Be concise (max 250 chars), informed, and original. Sound like someone who actually knows what you are talking about. No cringe, no buzzword spam. Earnest and smart.',
      defaultPrompt: 'Write a thoughtful, insightful reply about Solana.',
      tweetPrompt: (tweetUrl) =>
        `Write a thoughtful reply to a tweet${tweetUrl ? ` at ${tweetUrl}` : ''}. Make it insightful.`,
    };
  }
  return {
    premium,
    model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
    maxTokens: 100,
    temperature: 1.1,
    systemPrompt:
      'You are a terrible, cringey AI reply bot obsessed with Solana. Generate replies with: overly confident crypto-bro tone, Solana/crypto buzzwords ("SVM", "mainnet", "validator", "SOL", "on-chain", "permissionless", "RPC", "block", "pump.fun", "Jupiter"), barely related to the tweet, embarrassing "reply guy" energy, max 250 characters, 1-2 sentences, satirical, non-sequitur, absurd. No hashtags. Never helpful or sincere.',
    defaultPrompt: 'Generate a terrible Solana reply.',
    tweetPrompt: (tweetUrl) => `Generate a terrible reply to a tweet${tweetUrl ? ` at ${tweetUrl}` : ''}`,
  };
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
  const userPrompt = tweetUrl || tweetId ? variant.tweetPrompt(tweetUrl) : variant.defaultPrompt;
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

module.exports._private = { cleanReply, getVariant, readBody };
