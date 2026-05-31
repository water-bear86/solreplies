export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tweetUrl, tweetId } = req.body || {};

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set');
    return res.json({ text: null });
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
        tweetText = d.html
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 500);
      }
    } catch (e) {
      console.error('oEmbed fetch failed:', e.message);
    }
  }

  const models = [
    'google/gemini-2.5-flash-lite:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-4-maverick:free',
    'deepseek/deepseek-chat-v3-0324:free',
  ];

  for (const model of models) {
    try {
      console.log(`Trying model: ${model}`);
      const ai = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.VERCEL_URL || 'https://solanareplygenerator.lol',
          'X-Title': 'Solana Reply Generator',
        },
        body: JSON.stringify({
          model,
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
                : 'Generate a terrible reply to a Solana-related tweet.',
            },
          ],
          max_tokens: 100,
          temperature: 1.1,
        }),
      });

      const d = await ai.json();

      if (d.error) {
        console.error(`Model ${model} error:`, JSON.stringify(d.error));
        continue;
      }

      const text = d.choices?.[0]?.message?.content?.trim();
      if (text) {
        console.log(`Success with model: ${model}`);
        return res.json({ text });
      }
      console.log(`Model ${model} returned no text`);
    } catch (e) {
      console.error(`Model ${model} failed:`, e.message);
    }
  }

  console.error('All models failed, returning null');
  return res.json({ text: null });
}
