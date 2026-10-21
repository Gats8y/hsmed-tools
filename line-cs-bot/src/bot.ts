// 收到一則 LINE 訊息後的分流邏輯。外部服務都從 deps 注入，方便測試。

import type { Classification } from "./classify";
import { CONFIG } from "./config";
import type { LineEvent } from "./line";
import type { StaffAlert } from "./notify";
import { describeTime, isStaffed, nextStaffedTime, specialistEta } from "./schedule";
import { phoneMatches, type OrderLookup } from "./orders";
import { pick } from "./templates";

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Deps {
  kv: KV;
  classify(text: string): Promise<Classification>;
  lookup: OrderLookup;
  reply(replyToken: string, text: string): Promise<void>;
  notify(alert: StaffAlert): Promise<void>;
  now(): Date;
}

interface UserState {
  /** 這個時間之前 AI 不再回覆這位客人（真人接手中） */
  silentUntil?: number;
  /** 正在等客人補訂單資料 */
  order?: { orderNumber: string | null; phoneLast: string | null; attempts: number };
}

const STATE_TTL = 60 * 60 * 24; // 一天

async function loadState(kv: KV, userId: string): Promise<UserState> {
  const raw = await kv.get(`user:${userId}`);
  return raw ? (JSON.parse(raw) as UserState) : {};
}

async function saveState(kv: KV, userId: string, s: UserState) {
  await kv.put(`user:${userId}`, JSON.stringify(s), { expirationTtl: STATE_TTL });
}

export type Outcome =
  | "ignored"
  | "duplicate"
  | "silenced"
  | "left_for_staff"
  | "medical_ack"
  | "off_hours_ack"
  | "ask_order_info"
  | "order_found"
  | "order_not_matched"
  | "order_handoff"
  | "order_error";

export async function handleEvent(deps: Deps, ev: LineEvent): Promise<Outcome> {
  if (ev.type !== "message" || ev.mode === "standby" || !ev.replyToken) return "ignored";
  if (ev.source?.type !== "user" || !ev.source.userId) return "ignored";
  const userId = ev.source.userId;

  // LINE 可能重送同一事件
  if (ev.webhookEventId) {
    const seenKey = `seen:${ev.webhookEventId}`;
    if (await deps.kv.get(seenKey)) return "duplicate";
    await deps.kv.put(seenKey, "1", { expirationTtl: 60 * 60 });
  }

  const now = deps.now();
  const state = await loadState(deps.kv, userId);
  if (state.silentUntil && state.silentUntil > now.getTime()) return "silenced";

  const text = ev.message?.type === "text" ? (ev.message.text ?? "") : "";
  const staffed = isStaffed(now);
  const replyToken = ev.replyToken;

  const handOff = async (template: "medicalAck" | "offHoursAck" | "orderHandoff" | "orderSystemError", reason: string) => {
    const vars: Record<string, string> = {};
    if (template === "medicalAck") {
      const eta = specialistEta(now);
      vars.expected = describeTime(eta.expected, now);
      vars.latest = describeTime(eta.latest, now);
    } else {
      vars.expected = describeTime(nextStaffedTime(now), now);
    }
    await deps.reply(replyToken, pick(template, vars, now.getTime()));
    await saveState(deps.kv, userId, { silentUntil: now.getTime() + CONFIG.handoffSilenceHours * 3600000 });
    await deps.notify({ reason, userId, text: text || `（${ev.message?.type ?? "非文字"}訊息）` });
  };

  if (!text) {
    // 貼圖、圖片等：上班時間交給真人，下班時間先回一句
    if (staffed) return "left_for_staff";
    await handOff("offHoursAck", "非上班時段收到非文字訊息");
    return "off_hours_ack";
  }

  const c = await deps.classify(text);
  const continuingOrder = !!state.order && (c.orderNumber !== null || c.phoneLast !== null);

  if (c.intent === "medical") {
    await handOff("medicalAck", "專業問題（藥效／身體狀況）");
    return "medical_ack";
  }

  if (c.intent === "order" || continuingOrder) {
    const orderNumber = c.orderNumber ?? state.order?.orderNumber ?? null;
    const phoneLast = c.phoneLast ?? state.order?.phoneLast ?? null;
    const attempts = state.order?.attempts ?? 0;

    if (!orderNumber || !phoneLast || phoneLast.length < CONFIG.phoneDigits) {
      await deps.reply(replyToken, pick("askOrderInfo", {}, now.getTime()));
      await saveState(deps.kv, userId, { order: { orderNumber, phoneLast, attempts } });
      return "ask_order_info";
    }

    let order;
    try {
      order = await deps.lookup(orderNumber);
    } catch (err) {
      console.error("order lookup failed", err);
      await handOff("orderSystemError", "查單系統錯誤");
      return "order_error";
    }

    if (order && phoneMatches(order, phoneLast)) {
      await deps.reply(replyToken, order.summary);
      await saveState(deps.kv, userId, {});
      return "order_found";
    }

    if (attempts + 1 >= CONFIG.maxOrderAttempts) {
      await handOff("orderHandoff", `查單資料對不上（訂單 ${orderNumber}）`);
      return "order_handoff";
    }
    await deps.reply(replyToken, pick("orderNotMatched", {}, now.getTime()));
    await saveState(deps.kv, userId, { order: { orderNumber: null, phoneLast: null, attempts: attempts + 1 } });
    return "order_not_matched";
  }

  // 其他問題：上班時間不插嘴，讓真人在 OA 後台回；下班時間先回一句並通知
  if (staffed) return "left_for_staff";
  await handOff("offHoursAck", "非上班時段的一般問題");
  return "off_hours_ack";
}
