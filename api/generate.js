import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return handleGenerate(req, res);
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.end(html);
}

async function handleGenerate(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.end(JSON.stringify({ text: null, error: 'no_api_key' }));
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  let tweetUrl, tweetId;
  try {
    ({ tweetUrl, tweetId } = JSON.parse(body || '{}'));
  } catch {
    return res.end(JSON.stringify({ text: null, error: 'bad_json' }));
  }

  let tweetText = '';
  if (tweetUrl || tweetId) {
    try {
      const url = tweetUrl || `https://x.com/i/status/${tweetId}`;
      const oembed = await fetch(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`
      );
      if (oembed.ok) {
        const d = await oembed.json();
        tweetText = d.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
      }
    } catch {}
  }

  const model = 'google/gemini-2.0-flash-exp:free';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const ai = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://solanareplygenerator.lol',
        'X-Title': 'Solana Reply Generator',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a terrible, cringey AI reply bot obsessed with Solana. Generate replies with: overly confident crypto-bro tone, Solana/crypto buzzwords ("SVM", "mainnet", "validator", "SOL", "on-chain", "permissionless", "RPC", "block", "pump.fun", "Jupiter"), barely related to the tweet, embarrassing "reply guy" energy, max 250 characters, 1-2 sentences, satirical, non-sequitur, absurd. No hashtags. Never helpful or sincere.',
          },
          {
            role: 'user',
            content: tweetText
              ? `Generate a terrible reply to: "${tweetText}"`
              : 'Generate a terrible Solana reply.',
          },
        ],
        max_tokens: 100,
        temperature: 1.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!ai.ok) {
      console.error('OpenRouter HTTP', ai.status);
      return res.end(JSON.stringify({ text: null, error: `http_${ai.status}` }));
    }

    const d = await ai.json();

    if (d.error) {
      console.error('OpenRouter error:', JSON.stringify(d.error));
      return res.end(JSON.stringify({ text: null, error: d.error.code || 'api_error' }));
    }

    const text = d.choices?.[0]?.message?.content?.trim();
    if (text) return res.end(JSON.stringify({ text }));

    return res.end(JSON.stringify({ text: null, error: 'no_text' }));
  } catch (e) {
    console.error('API call failed:', e.message);
    return res.end(JSON.stringify({ text: null, error: e.name === 'AbortError' ? 'timeout' : 'fetch_error' }));
  }
}
