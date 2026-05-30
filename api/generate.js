export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tweetUrl, tweetId } = req.body || {};
  if (!tweetUrl && !tweetId) return res.status(400).json({ error: 'Missing tweetUrl/tweetId' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.json({ text: null });

  let tweetText = '';
  try {
    const url = tweetUrl || `https://x.com/i/status/${tweetId}`;
    const oembed = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`
    );
    if (oembed.ok) {
      const d = await oembed.json();
      tweetText = d.html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500);
    }
  } catch {}

  try {
    const ai = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.VERCEL_URL || 'https://replygenerator.lol',
        'X-Title': 'AI Reply Generator',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite:free',
        messages: [
          {
            role: 'system',
            content:
              'You are a terrible, cringey AI reply bot obsessed with Solana. Generate replies with: overly confident crypto-bro tone, Solana/crypto buzzwords ("SVM", "mainnet", "validator", "SOL", "on-chain", "permissionless", "RPC", "block", "pump.fun", "Jupiter", "ecosystem"), barely related to the tweet, embarrassing "reply guy" energy, max 250 characters, 1-2 sentences, satirical, non-sequitur, absurd. No hashtags. Never be helpful or sincere. Sound like a Solana builder who automated his personality and deployed it to mainnet.',
          },
          {
            role: 'user',
            content: tweetText
              ? `Generate a terrible reply to this tweet: "${tweetText}"`
              : 'Generate a terrible reply to a tweet.',
          },
        ],
        max_tokens: 100,
        temperature: 1.1,
      }),
    });
    const d = await ai.json();
    const text = d.choices?.[0]?.message?.content?.trim();
    if (text) return res.json({ text });
  } catch {}

  return res.json({ text: null });
}
