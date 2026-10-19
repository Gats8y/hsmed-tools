import { CONFIG, type ShiftWindow } from "./config";

const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把 UTC 時間轉成「台灣當地的年月日時分」，用 UTC getter 讀取 */
export function toTaipei(d: Date): Date {
  return new Date(d.getTime() + TPE_OFFSET_MS);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function ymd(local: Date): string {
  return local.toISOString().slice(0, 10);
}

export function isWithin(windows: ShiftWindow[], now: Date, holidays: string[] = []): boolean {
  const local = toTaipei(now);
  if (holidays.includes(ymd(local))) return false;
  const day = local.getUTCDay();
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  return windows.some((w) => w.days.includes(day) && mins >= minutesOf(w.start) && mins < minutesOf(w.end));
}

export function isStaffed(now: Date): boolean {
  return isWithin(CONFIG.staffed, now);
}

export interface ReplyEta {
  /** 預計回覆時間（台灣時間的 Date，用 UTC getter 讀） */
  expected: Date;
  /** 最晚回覆時間：專業同仁該班次結束 */
  latest: Date;
  /** 專業同仁現在是否在班 */
  onShiftNow: boolean;
}

/** 依專業同仁班表，算出預計與最晚回覆時間 */
export function specialistEta(now: Date): ReplyEta {
  const holidays = CONFIG.specialistHolidays;
  const local = toTaipei(now);
  const nowMins = local.getUTCHours() * 60 + local.getUTCMinutes();

  for (let offset = 0; offset < 30; offset++) {
    const day = new Date(local.getTime() + offset * 86400000);
    if (holidays.includes(ymd(day))) continue;
    const dow = day.getUTCDay();
    for (const w of CONFIG.specialist) {
      if (!w.days.includes(dow)) continue;
      const start = minutesOf(w.start);
      const end = minutesOf(w.end);
      if (offset === 0 && nowMins >= end) continue;
      const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      const onShiftNow = offset === 0 && nowMins >= start;
      const from = onShiftNow ? nowMins : start;
      const expectedMins = Math.min(from + CONFIG.specialistReplyWithinHours * 60, end);
      return {
        expected: new Date(base + expectedMins * 60000),
        latest: new Date(base + end * 60000),
        onShiftNow,
      };
    }
  }
  throw new Error("specialist schedule has no working day in the next 30 days");
}

/** 一般客服下一次有人在線的時間；現在有人就回傳「現在起一小時、取整點半」 */
export function nextStaffedTime(now: Date): Date {
  const local = toTaipei(now);
  if (isStaffed(now)) {
    const t = new Date(local.getTime() + 60 * 60000);
    const m = t.getUTCMinutes();
    t.setUTCMinutes(m === 0 || m === 30 ? m : m < 30 ? 30 : 60, 0, 0);
    return t;
  }
  const nowMins = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(local.getTime() + offset * 86400000);
    const starts = CONFIG.staffed
      .filter((w) => w.days.includes(day.getUTCDay()))
      .map((w) => minutesOf(w.start))
      .filter((s) => offset > 0 || s > nowMins)
      .sort((a, b) => a - b);
    if (starts.length) {
      const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      return new Date(base + starts[0] * 60000);
    }
  }
  throw new Error("staffed schedule has no shift in the next week");
}

const WEEKDAY =["日", "一", "二", "三", "四", "五", "六"];

/** 把台灣時間的 Date 寫成客人看得懂的說法，例如「今天下午 3 點左右」「明天（週二）早上 9 點」 */
export function describeTime(target: Date, now: Date): string {
  const local = toTaipei(now);
  const dayDiff = Math.round(
    (Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()) -
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())) /
      86400000,
  );
  const dayLabel =
    dayDiff === 0
      ? "今天"
      : dayDiff === 1
        ? `明天（週${WEEKDAY[target.getUTCDay()]}）`
        : `${target.getUTCMonth() + 1}/${target.getUTCDate()}（週${WEEKDAY[target.getUTCDay()]}）`;
  const h = target.getUTCHours();
  const m = target.getUTCMinutes();
  const period = h < 12 ? "早上" : h < 19 ? "下午" : "晚上";
  const h12 = h > 12 ? h - 12 : h;
  return `${dayLabel}${period} ${h12} 點${m ? ` ${m} 分` : ""}`;
}
