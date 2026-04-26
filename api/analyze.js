const DEFAULT_PRODUCTS = {
  oily: [
    { step: "Cleanser", title: "Oil Off Foam Cleanser", handle: "oil-off-foam-cleanser", reason: "Foam cleanser for excess oil and pores" },
    { step: "Serum", title: "Oil Off Serum", handle: "oil-off-serum", reason: "Lightweight serum for shine and visible pores" },
    { step: "Moisturizer", title: "Oil Off Moisturizer", handle: "oil-off-moisturizer", reason: "Oil-free hydration without heaviness" }
  ],
  combination: [
    { step: "Cleanser", title: "Oil Off Foam Cleanser", handle: "oil-off-foam-cleanser", reason: "Balances oily T-zone without stripping" },
    { step: "Serum", title: "Oil Off Serum", handle: "oil-off-serum", reason: "Targets pores and uneven oil production" },
    { step: "Moisturizer", title: "Oil Off Moisturizer", handle: "oil-off-moisturizer", reason: "Light hydration for mixed skin zones" }
  ],
  dry: [
    { step: "Cleanser", title: "Gentle Hydrating Cleanser", handle: "gentle-hydrating-cleanser", reason: "Non-stripping cleanse for dry-feeling skin" },
    { step: "Moisturizer", title: "Barrier Repair Moisturizer", handle: "barrier-repair-moisturizer", reason: "Supports comfort and hydration" }
  ],
  sensitive: [
    { step: "Cleanser", title: "Gentle Hydrating Cleanser", handle: "gentle-hydrating-cleanser", reason: "Gentle option for visible sensitivity" },
    { step: "Moisturizer", title: "Barrier Repair Moisturizer", handle: "barrier-repair-moisturizer", reason: "Helps support the skin barrier" }
  ],
  normal: [
    { step: "Cleanser", title: "Oil Off Foam Cleanser", handle: "oil-off-foam-cleanser", reason: "Simple daily cleanse" },
    { step: "Moisturizer", title: "Oil Off Moisturizer", handle: "oil-off-moisturizer", reason: "Light daily hydration" }
  ]
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function pickProducts(skinType, concerns = []) {
  const map = safeJsonParse(process.env.PRODUCT_MAP_JSON || "", DEFAULT_PRODUCTS);
  const key = String(skinType || "normal").toLowerCase();
  let products = map[key] || map.normal || DEFAULT_PRODUCTS.normal;

  // Tiny commercial rule: if oily/acne/pores appear, prefer Oil Off routine when available.
  const concernText = concerns.join(" ").toLowerCase();
  if (/oil|oily|acne|pore|shine|comedone|blackhead/.test(concernText) && map.oily) products = map.oily;
  return products.slice(0, 5);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { image, answers = {} } = req.body || {};
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Please upload a clear face image." });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on backend." });
    }

    const prompt = `
You are a cosmetic skincare assistant for an ecommerce skincare brand.
Analyze the uploaded portrait conservatively from visible cues only.
Do not diagnose disease. Do not claim certainty. Do not mention prescription medicine.
Return ONLY valid JSON matching this structure:
{
  "skin_type": "oily|dry|combination|normal|sensitive",
  "confidence": 0-100,
  "skin_score": 0-100,
  "summary": "max 16 words",
  "top_concerns": ["max 4 short concerns"],
  "zones": {
    "forehead": {"note":"max 12 words", "needs":["max 2"]},
    "eyes": {"note":"max 12 words", "needs":["max 2"]},
    "cheeks": {"note":"max 12 words", "needs":["max 2"]},
    "nose": {"note":"max 12 words", "needs":["max 2"]},
    "chin": {"note":"max 12 words", "needs":["max 2"]}
  },
  "morning_routine": ["3-5 short steps"],
  "night_routine": ["3-5 short steps"],
  "disclaimer": "Cosmetic guidance only, not medical diagnosis."
}
User self answers, if any: ${JSON.stringify(answers)}
`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: image }
            ]
          }
        ],
        temperature: 0.2,
        max_output_tokens: 1200
      })
    });

    const raw = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: raw?.error?.message || "AI request failed" });
    }

    const text = raw.output_text || raw.output?.flatMap(o => o.content || []).map(c => c.text || "").join("\n") || "";
    const cleaned = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
    const analysis = safeJsonParse(cleaned, null);

    if (!analysis) return res.status(502).json({ error: "AI returned invalid JSON", raw: text.slice(0, 500) });

    const products = pickProducts(analysis.skin_type, analysis.top_concerns || []);
    return res.status(200).json({ analysis, products });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
