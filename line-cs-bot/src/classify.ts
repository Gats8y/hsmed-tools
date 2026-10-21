import Anthropic from "@anthropic-ai/sdk";

export type Intent = "order" | "medical" | "other";

export interface Classification {
  intent: Intent;
  orderNumber: string | null;
  phoneLast: string | null;
}

const SYSTEM_PROMPT = `你是醫療保健商品品牌 LINE 客服的訊息分類器。你不回覆客人，只把客人的訊息分類並抽出資料。

分類：
- "medical"：任何跟身體、健康、藥效、藥性、成分作用、適不適合吃、怎麼吃、劑量、副作用、過敏、懷孕哺乳、跟其他藥物或保健品一起吃、疾病、症狀、生理機能有關的問題。只要沾到一點邊就選這個。
- "order"：查詢自己的訂單狀態、出貨、物流、到貨、付款狀態。
- "other"：其他所有訊息（打招呼、問門市資訊、退換貨、抱怨、商品價格、活動、看不懂的內容等）。

規則：
- 同時有訂單問題和身體／藥效問題時，選 "medical"。
- 不確定時選 "other"，不要猜。
- orderNumber：只有客人訊息中「原文出現」的訂單編號才填，否則填 null。不要推測或補字。
- phoneLast：客人提供的手機末幾碼（3 到 4 位數字），原文沒有就填 null。`;

const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["order", "medical", "other"] },
    orderNumber: { type: ["string", "null"] },
    phoneLast: { type: ["string", "null"] },
  },
  required: ["intent", "orderNumber", "phoneLast"],
  additionalProperties: false,
} as const;

const FALLBACK: Classification = { intent: "other", orderNumber: null, phoneLast: null };

/**
 * 用 Claude 分類。任何錯誤、拒答、格式不對，一律回傳 "other"（交給真人），
 * 而且抽出的號碼必須真的出現在原文，避免模型捏造。
 */
export async function classify(client: Anthropic, model: string, text: string): Promise<Classification> {
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });
    if (res.stop_reason === "refusal") return FALLBACK;
    const raw = res.content.find((b) => b.type === "text");
    if (!raw || raw.type !== "text") return FALLBACK;
    return sanitize(JSON.parse(raw.text), text);
  } catch (err) {
    console.error("classify failed", err);
    return FALLBACK;
  }
}

export function sanitize(parsed: unknown, original: string): Classification {
  if (!parsed || typeof parsed !== "object") return FALLBACK;
  const p = parsed as Record<string, unknown>;
  const intent = p.intent === "order" || p.intent === "medical" || p.intent === "other" ? p.intent : null;
  if (!intent) return FALLBACK;
  const compact = original.replace(/\s/g, "");
  const keep = (v: unknown, re: RegExp) =>
    typeof v === "string" && re.test(v) && compact.includes(v) ? v : null;
  return {
    intent,
    orderNumber: keep(p.orderNumber, /^[A-Za-z0-9-]{3,40}$/),
    phoneLast: keep(p.phoneLast, /^\d{3,4}$/),
  };
}
