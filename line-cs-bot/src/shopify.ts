// Shopify Admin GraphQL API：只做一個唯讀查詢（orders），App 只需要 read_orders 權限。
// 文件：https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
// 注意：read_orders 預設只看得到最近 60 天的訂單，更舊的要另外申請 read_all_orders。

import type { KV } from "./bot";
import { OrderApiError, tpeDate, type OrderLookup, type OrderRecord } from "./orders";

const API_VERSION = "2026-10";

export interface ShopifyConfig {
  /** 商店子網域，例如 abc（abc.myshopify.com） */
  shop: string;
  /** 2026 年以前在後台建立的舊版自訂 App 會有固定的 shpat_ token，有就直接用 */
  accessToken?: string;
  /** Dev Dashboard 建立的 App：用 Client ID / Secret 換 24 小時的 token */
  clientId?: string;
  clientSecret?: string;
}

async function getToken(cfg: ShopifyConfig, kv: KV): Promise<string> {
  if (cfg.accessToken) return cfg.accessToken;
  if (!cfg.clientId || !cfg.clientSecret) throw new OrderApiError("Shopify credentials missing");
  const cached = await kv.get("shopify:token");
  if (cached) return cached;
  const res = await fetch(`https://${cfg.shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) throw new OrderApiError(`Shopify token ${res.status}: ${await res.text()}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // 提早 10 分鐘過期，避免用到快過期的 token
  await kv.put("shopify:token", access_token, { expirationTtl: Math.max(60, expires_in - 600) });
  return access_token;
}

const QUERY = `query OrderByName($q: String!) {
  orders(first: 5, query: $q) {
    nodes {
      name
      createdAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      phone
      shippingAddress { phone }
      billingAddress { phone }
      fulfillments(first: 5) {
        displayStatus
        createdAt
        deliveredAt
        trackingInfo(first: 3) { company number url }
      }
    }
  }
}`;

export interface ShopifyOrder {
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  phone: string | null;
  shippingAddress: { phone: string | null } | null;
  billingAddress: { phone: string | null } | null;
  fulfillments: {
    displayStatus: string | null;
    createdAt: string;
    deliveredAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
  }[];
}

export const stripHash = (s: string) => s.replace(/^#/, "");

export function shopifyLookup(cfg: ShopifyConfig, kv: KV): OrderLookup {
  return async (orderNumber) => {
    const n = stripHash(orderNumber);
    const token = await getToken(cfg, kv);
    const res = await fetch(`https://${cfg.shop}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY, variables: { q: `name:${n}` } }),
    });
    if (res.status === 401) await kv.delete("shopify:token");
    if (!res.ok) throw new OrderApiError(`Shopify ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: { orders: { nodes: ShopifyOrder[] } }; errors?: unknown };
    if (body.errors || !body.data) throw new OrderApiError(`Shopify GraphQL: ${JSON.stringify(body.errors)}`);
    // 搜尋可能比對到相近的編號，只接受完全相同的那一筆
    const order = body.data.orders.nodes.find((o) => stripHash(o.name) === n);
    return order ? toRecord(order) : null;
  };
}

const FINANCIAL: Record<string, string> = {
  AUTHORIZED: "付款處理中",
  PENDING: "付款處理中",
  PAID: "已付款",
  PARTIALLY_PAID: "部分付款",
  PARTIALLY_REFUNDED: "部分退款",
  REFUNDED: "已退款",
  VOIDED: "付款已取消",
  EXPIRED: "付款已逾期",
};

const ORDER_FULFILLMENT: Record<string, string> = {
  UNFULFILLED: "備貨中",
  PENDING_FULFILLMENT: "備貨中",
  OPEN: "備貨中",
  IN_PROGRESS: "準備出貨中",
  SCHEDULED: "已排定出貨",
  ON_HOLD: "暫緩出貨",
  PARTIALLY_FULFILLED: "部分商品已出貨",
  FULFILLED: "已出貨",
  RESTOCKED: "已退回庫存",
};

const SHIPMENT: Record<string, string> = {
  CONFIRMED: "已出貨",
  FULFILLED: "已出貨",
  MARKED_AS_FULFILLED: "已出貨",
  LABEL_PRINTED: "已出貨",
  LABEL_PURCHASED: "已出貨",
  SUBMITTED: "已出貨",
  CARRIER_PICKED_UP: "物流已取件",
  IN_TRANSIT: "運送中",
  OUT_FOR_DELIVERY: "配送中",
  READY_FOR_PICKUP: "已到店，可以取貨",
  DELIVERED: "已送達",
  PICKED_UP: "已取貨",
  ATTEMPTED_DELIVERY: "配送未成功",
  DELAYED: "運送延遲",
  NOT_DELIVERED: "配送未成功",
  FAILURE: "配送異常",
};

export function toRecord(o: ShopifyOrder): OrderRecord {
  const lines = [`幫您查到了～訂單 ${o.name}`];
  const created = tpeDate(o.createdAt);
  if (created) lines.push(`・下單日期：${created}`);
  if (o.cancelledAt) {
    lines.push("・訂單狀態：已取消");
  } else {
    const pay = o.displayFinancialStatus && FINANCIAL[o.displayFinancialStatus];
    if (pay) lines.push(`・付款狀態：${pay}`);
    const ful = ORDER_FULFILLMENT[o.displayFulfillmentStatus];
    if (ful) lines.push(`・出貨狀態：${ful}`);
    o.fulfillments.forEach((f, i) => {
      const prefix = o.fulfillments.length > 1 ? `第 ${i + 1} 包裹` : "包裹";
      const st = f.displayStatus && SHIPMENT[f.displayStatus];
      const date = tpeDate(f.deliveredAt) ?? tpeDate(f.createdAt);
      if (st) lines.push(`・${prefix}：${st}${date ? `（${date}）` : ""}`);
      for (const t of f.trackingInfo) {
        if (t.number) lines.push(`・物流單號：${t.company ? `${t.company} ` : ""}${t.number}`);
        if (t.url) lines.push(`・貨件追蹤：${t.url}`);
      }
    });
  }
  lines.push("有其他問題再跟我說喔😊");
  return {
    number: stripHash(o.name),
    phones: [o.phone, o.shippingAddress?.phone, o.billingAddress?.phone],
    summary: lines.join("\n"),
  };
}
