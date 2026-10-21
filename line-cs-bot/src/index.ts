import Anthropic from "@anthropic-ai/sdk";
import { handleEvent, type Deps } from "./bot";
import { classify } from "./classify";
import { forward, reply, verifySignature, type LineEvent } from "./line";
import { notifyStaff } from "./notify";
import { shopifyLookup } from "./shopify";

export interface Env {
  STATE: KVNamespace;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  SHOPIFY_SHOP: string;
  SHOPIFY_ACCESS_TOKEN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  CLAUDE_MODEL?: string;
  STAFF_WEBHOOK_URL?: string;
  STAFF_WEBHOOK_KIND?: string;
  /** 逗號分隔，原本接在 LINE OA 上的 webhook 網址，原封轉發 */
  FORWARD_WEBHOOK_URLS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return new Response("ok");

    const body = await request.text();
    const signature = request.headers.get("x-line-signature");
    if (!(await verifySignature(env.LINE_CHANNEL_SECRET, body, signature))) {
      return new Response("bad signature", { status: 401 });
    }

    const forwardUrls = (env.FORWARD_WEBHOOK_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (forwardUrls.length) ctx.waitUntil(forward(forwardUrls, body, signature!));

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const model = env.CLAUDE_MODEL || "claude-opus-5-5";
    const deps: Deps = {
      kv: env.STATE,
      classify: (text) => classify(client, model, text),
      lookup: shopifyLookup(
        {
          shop: env.SHOPIFY_SHOP,
          accessToken: env.SHOPIFY_ACCESS_TOKEN,
          clientId: env.SHOPIFY_CLIENT_ID,
          clientSecret: env.SHOPIFY_CLIENT_SECRET,
        },
        env.STATE,
      ),
      reply: (token, text) => reply(env.LINE_CHANNEL_ACCESS_TOKEN, token, text),
      notify: (alert) => notifyStaff(env.STAFF_WEBHOOK_URL, env.STAFF_WEBHOOK_KIND, alert),
      now: () => new Date(),
    };

    const { events = [] } = JSON.parse(body) as { events?: LineEvent[] };
    // 先回 200 給 LINE，處理放到背景
    ctx.waitUntil(
      Promise.all(
        events.map((ev) =>
          handleEvent(deps, ev)
            .then((outcome) => console.log("event", ev.webhookEventId, outcome))
            .catch((err) => console.error("event failed", ev.webhookEventId, err)),
        ),
      ),
    );
    return new Response("ok");
  },
};
