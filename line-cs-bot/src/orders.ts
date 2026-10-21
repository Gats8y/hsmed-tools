// 電商平台無關的訂單介面。目前實作是 SHOPLINE（src/shopline.ts），換平台只要另寫一個 OrderLookup。

export interface OrderRecord {
  /** 客人看到的訂單編號 */
  number: string;
  /** 用來比對手機末碼的電話（訂購人、收件人等） */
  phones: (string | null | undefined)[];
  /** 已排好、可以直接回給客人的訂單摘要（不含姓名、地址、電話） */
  summary: string;
}

export type OrderLookup = (orderNumber: string) => Promise<OrderRecord | null>;

export class OrderApiError extends Error {}

export function phoneMatches(order: OrderRecord, last: string): boolean {
  return order.phones.some((p) => typeof p === "string" && p.replace(/\D/g, "").endsWith(last));
}

export function tpeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + 8 * 3600000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
