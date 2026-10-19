// SHOPLINE Open API：只用「Search Orders」一支唯讀 API。
// 文件：https://open-api.docs.shoplineapp.com/reference/get_orders-search-1

const BASE = "https://open.shopline.io/v1";

interface Translations {
  "zh-hant"?: string;
  en?: string;
}

export interface ShoplineOrder {
  id: string;
  order_number: string;
  merchant_order_number?: string | null;
  status?: string;
  created_at?: string;
  customer_phone?: string | null;
  delivery_address?: { recipient_phone?: string | null } | null;
  order_payment?: { status?: string | null; name_translations?: Translations | null } | null;
  order_delivery?: {
    status?: string | null;
    name_translations?: Translations | null;
    shipped_at?: string | null;
    arrived_at?: string | null;
  } | null;
  delivery_data?: {
    tracking_number?: string | null;
    url?: string | null;
    location_name?: string | null;
    scheduled_delivery_date?: string | null;
  } | null;
}

export class ShoplineError extends Error {}

export type OrderLookup = (orderNumber: string) => Promise<ShoplineOrder | null>;

export function shoplineLookup(token: string): OrderLookup {
  return async (orderNumber) => {
    const url = new URL(`${BASE}/orders/search`);
    url.searchParams.set("order_number", orderNumber);
    url.searchParams.set("per_page", "5");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new ShoplineError(`SHOPLINE ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { items?: ShoplineOrder[] };
    // 搜尋可能是模糊比對，這裡只接受編號完全相同的那一筆
    return (
      body.items?.find((o) => o.order_number === orderNumber || o.merchant_order_number === orderNumber) ?? null
    );
  };
}

/** 客人給的手機末碼，要跟訂購人或收件人手機吻合 */
export function phoneMatches(order: ShoplineOrder, last: string): boolean {
  const phones = [order.customer_phone, order.delivery_address?.recipient_phone];
  return phones.some((p) => typeof p === "string" && p.replace(/\D/g, "").endsWith(last));
}

const ORDER_STATUS: Record<string, string> = {
  temp: "處理中",
  pending: "處理中",
  confirmed: "已確認",
  completed: "已完成",
  cancelled: "已取消",
  removed: "已取消",
};

const PAYMENT_STATUS: Record<string, string> = {
  pending: "尚未付款",
  failed: "付款失敗",
  expired: "已超過付款期限",
  completed: "已付款",
  refunding: "退款中",
  refunded: "已退款",
};

const DELIVERY_STATUS: Record<string, string> = {
  pending: "備貨中",
  shipping: "準備出貨中",
  shipped: "已出貨",
  arrived: "已送達",
  collected: "已取貨",
  returned: "已退貨",
  returning: "退貨處理中",
};

function tpeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + 8 * 3600000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 把訂單資料排成固定格式。只放 API 回傳的原始欄位，沒有的就不顯示，
 * 不放姓名、地址、電話等個資。
 */
export function formatOrder(o: ShoplineOrder): string {
  const lines = [`幫您查到了～訂單 ${o.order_number}`];
  const created = tpeDate(o.created_at);
  if (created) lines.push(`・下單日期：${created}`);
  if (o.status && ORDER_STATUS[o.status]) lines.push(`・訂單狀態：${ORDER_STATUS[o.status]}`);
  const pay = o.order_payment?.status;
  if (pay && PAYMENT_STATUS[pay]) lines.push(`・付款狀態：${PAYMENT_STATUS[pay]}`);
  const method = o.order_delivery?.name_translations?.["zh-hant"];
  if (method) lines.push(`・配送方式：${method}`);
  const del = o.order_delivery?.status;
  if (del && DELIVERY_STATUS[del]) lines.push(`・出貨狀態：${DELIVERY_STATUS[del]}`);
  const shipped = tpeDate(o.order_delivery?.shipped_at);
  if (shipped) lines.push(`・出貨日期：${shipped}`);
  const arrived = tpeDate(o.order_delivery?.arrived_at);
  if (arrived) lines.push(`・到店／送達日期：${arrived}`);
  if (o.delivery_data?.location_name) lines.push(`・取貨門市：${o.delivery_data.location_name}`);
  if (o.delivery_data?.tracking_number) lines.push(`・物流單號：${o.delivery_data.tracking_number}`);
  if (o.delivery_data?.url) lines.push(`・貨件追蹤：${o.delivery_data.url}`);
  lines.push("有其他問題再跟我說喔😊");
  return lines.join("\n");
}
