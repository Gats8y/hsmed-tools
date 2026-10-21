// LINE Messaging API：驗證 webhook 簽章、用 Reply API 回覆（Reply API 不計入月訊息則數）。

export interface LineEvent {
  type: string;
  mode?: string;
  webhookEventId?: string;
  replyToken?: string;
  deliveryContext?: { isRedelivery?: boolean };
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

export async function verifySignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export async function reply(accessToken: string, replyToken: string, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error("LINE reply failed", res.status, await res.text());
}

/**
 * 原本已經接在 LINE OA 上的系統（例如 Shopify 上的 LINE 串接 App）如果也用 webhook，
 * LINE 一個頻道只能填一個 webhook 網址，所以由這裡原封不動轉發，簽章不變、對方照常驗證。
 */
export async function forward(urls: string[], body: string, signature: string): Promise<void> {
  await Promise.allSettled(
    urls.map((u) =>
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-line-signature": signature },
        body,
      }),
    ),
  );
}
