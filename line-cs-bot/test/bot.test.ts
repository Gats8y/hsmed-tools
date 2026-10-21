import { describe, expect, it } from "vitest";
import { handleEvent, type Deps, type KV } from "../src/bot";
import type { Classification } from "../src/classify";
import { sanitize } from "../src/classify";
import type { LineEvent } from "../src/line";
import { describeTime, isStaffed, nextStaffedTime, specialistEta } from "../src/schedule";
import { toRecord, type ShoplineOrder } from "../src/shopline";

// 台灣時間 → Date
const tpe = (s: string) => new Date(`${s}+08:00`);

class MemKV implements KV {
  m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
  async delete(k: string) {
    this.m.delete(k);
  }
}

const SHOPLINE_ORDER: ShoplineOrder = {
  id: "o1",
  order_number: "20261018123456789",
  status: "confirmed",
  created_at: "2026-10-18T02:00:00Z",
  customer_phone: "0912345678",
  order_payment: { status: "completed" },
  order_delivery: { status: "shipped", name_translations: { "zh-hant": "7-11 取貨" }, shipped_at: "2026-10-19T03:00:00Z" },
  delivery_data: { tracking_number: "F123", location_name: "台北門市" },
};
const ORDER = toRecord(SHOPLINE_ORDER);

function setup(now: string, cls: Partial<Classification> | ((t: string) => Partial<Classification>), opts: { lookupThrows?: boolean } = {}) {
  const kv = new MemKV();
  const replies: string[] = [];
  const alerts: string[] = [];
  const deps: Deps = {
    kv,
    classify: async (t) => ({ intent: "other", orderNumber: null, phoneLast: null, ...(typeof cls === "function" ? cls(t) : cls) }),
    lookup: async (n) => {
      if (opts.lookupThrows) throw new Error("500");
      return n === ORDER.number ? ORDER : null;
    },
    reply: async (_t, text) => {
      replies.push(text);
    },
    notify: async (a) => {
      alerts.push(a.reason);
    },
    now: () => tpe(now),
  };
  return { deps, kv, replies, alerts };
}

let n = 0;
const msg = (text: string, userId = "U1"): LineEvent => ({
  type: "message",
  mode: "active",
  webhookEventId: `e${n++}`,
  replyToken: "rt",
  source: { type: "user", userId },
  message: { type: "text", text },
});

describe("schedule", () => {
  it("週一早上沒人、下午有人、晚上 10 點後沒人", () => {
    expect(isStaffed(tpe("2026-10-19T10:00:00"))).toBe(false); // 週一
    expect(isStaffed(tpe("2026-10-19T14:00:00"))).toBe(true);
    expect(isStaffed(tpe("2026-10-20T21:59:00"))).toBe(true);
    expect(isStaffed(tpe("2026-10-20T22:00:00"))).toBe(false);
    expect(isStaffed(tpe("2026-10-25T09:00:00"))).toBe(true); // 週日
  });

  it("專業同仁：週五晚上問，預計下週一", () => {
    const now = tpe("2026-10-23T20:00:00");
    const eta = specialistEta(now);
    expect(describeTime(eta.expected, now)).toBe("10/26（週一）早上 11 點");
    expect(describeTime(eta.latest, now)).toBe("10/26（週一）下午 6 點");
  });

  it("專業同仁：上班中問，兩小時內，最晚今天下班", () => {
    const now = tpe("2026-10-20T15:00:00");
    const eta = specialistEta(now);
    expect(describeTime(eta.expected, now)).toBe("今天下午 5 點");
    expect(describeTime(eta.latest, now)).toBe("今天下午 6 點");
  });

  it("下一次有人在線：週一凌晨 → 週一下午 1 點", () => {
    const now = tpe("2026-10-19T02:00:00");
    expect(describeTime(nextStaffedTime(now), now)).toBe("今天下午 1 點");
  });
});

describe("分流", () => {
  it("藥效問題：回已轉達、通知同仁、之後靜音", async () => {
    const { deps, replies, alerts } = setup("2026-10-20T15:00:00", { intent: "medical" });
    expect(await handleEvent(deps, msg("這個孕婦可以吃嗎"))).toBe("medical_ack");
    expect(replies[0]).toMatch(/今天下午 5 點/);
    expect(alerts).toHaveLength(1);
    expect(await handleEvent(deps, msg("請問呢？"))).toBe("silenced");
    expect(replies).toHaveLength(1);
  });

  it("上班時間的一般問題：AI 不插嘴", async () => {
    const { deps, replies } = setup("2026-10-20T15:00:00", { intent: "other" });
    expect(await handleEvent(deps, msg("門市在哪"))).toBe("left_for_staff");
    expect(replies).toHaveLength(0);
  });

  it("下班時間的一般問題：先回一句", async () => {
    const { deps, replies, alerts } = setup("2026-10-20T23:00:00", { intent: "other" });
    expect(await handleEvent(deps, msg("門市在哪"))).toBe("off_hours_ack");
    expect(replies[0]).toMatch(/明天（週三）早上 9 點/);
    expect(alerts).toHaveLength(1);
  });

  it("查單：分兩次給資料，查到後回訂單資訊、不含個資", async () => {
    const { deps, replies } = setup("2026-10-20T23:00:00", (t) =>
      t.includes("20261018123456789") ? { intent: "other", orderNumber: "20261018123456789", phoneLast: "678" } : { intent: "order" },
    );
    expect(await handleEvent(deps, msg("我的貨到了嗎"))).toBe("ask_order_info");
    expect(await handleEvent(deps, msg("20261018123456789 678"))).toBe("order_found");
    expect(replies[1]).toContain("已出貨");
    expect(replies[1]).toContain("F123");
    expect(replies[1]).not.toContain("0912");
  });

  it("查單：手機末碼錯兩次就轉真人", async () => {
    const { deps, alerts } = setup("2026-10-20T15:00:00", { intent: "order", orderNumber: "20261018123456789", phoneLast: "111" });
    expect(await handleEvent(deps, msg("20261018123456789 111"))).toBe("order_not_matched");
    expect(await handleEvent(deps, msg("20261018123456789 111"))).toBe("order_handoff");
    expect(alerts).toHaveLength(1);
  });

  it("查單系統掛了：轉真人", async () => {
    const { deps, alerts } = setup("2026-10-20T15:00:00", { intent: "order", orderNumber: "20261018123456789", phoneLast: "678" }, { lookupThrows: true });
    expect(await handleEvent(deps, msg("20261018123456789 678"))).toBe("order_error");
    expect(alerts).toHaveLength(1);
  });

  it("LINE 重送同一事件不會回兩次", async () => {
    const { deps, replies } = setup("2026-10-20T15:00:00", { intent: "medical" });
    const ev = msg("副作用？");
    await handleEvent(deps, ev);
    expect(await handleEvent(deps, ev)).toBe("duplicate");
    expect(replies).toHaveLength(1);
  });
});

describe("AI 輸出檢查", () => {
  it("原文沒有的訂單編號會被丟掉", () => {
    expect(sanitize({ intent: "order", orderNumber: "99999999", phoneLast: null }, "我的訂單呢")).toEqual({
      intent: "order",
      orderNumber: null,
      phoneLast: null,
    });
  });
  it("格式錯誤一律當 other", () => {
    expect(sanitize({ intent: "refund" }, "x").intent).toBe("other");
    expect(sanitize(null, "x").intent).toBe("other");
  });
});

describe("SHOPLINE 訂單格式", () => {
  it("回覆不含電話、含物流資訊", () => {
    expect(ORDER.summary).toContain("7-11 取貨");
    expect(ORDER.summary).toContain("台北門市");
    expect(ORDER.summary).not.toContain("0912");
  });
  it("已取消的訂單顯示已取消", () => {
    expect(toRecord({ ...SHOPLINE_ORDER, status: "cancelled" }).summary).toContain("已取消");
  });
});
