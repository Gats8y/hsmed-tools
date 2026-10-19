// 所有可調整的營運規則都集中在這裡，改這個檔就好，不用動流程程式。
// 時間一律是台灣時間（UTC+8，無日光節約）。

export interface ShiftWindow {
  /** 0=週日, 1=週一, ... 6=週六 */
  days: number[];
  /** "HH:MM" 24 小時制 */
  start: string;
  end: string;
}

export const CONFIG = {
  /** 一般客服（門市＋行銷）有人在線的時段：AI 這時只處理查單與「專業問題先回覆已轉達」，其他交給真人 */
  staffed: [
    { days: [0, 2, 3, 4, 5, 6], start: "09:00", end: "22:00" },
    // 週一早上休，⚠️ 週一幾點開始有人需要你確認，先假設 13:00
    { days: [1], start: "13:00", end: "22:00" },
  ] as ShiftWindow[],

  /** 專業同仁（月亮、怡臻）在線時段，用來計算「預計／最晚回覆時間」。⚠️ 上班開始時間先假設 09:00 */
  specialist: [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }] as ShiftWindow[],

  /** 國定假日（專業同仁不上班的日子），格式 YYYY-MM-DD */
  specialistHolidays: [] as string[],

  /** 專業同仁上班後，預計多久內回覆（小時） */
  specialistReplyWithinHours: 2,

  /** AI 回過「已轉達」之後，對同一位客人靜音多久（小時），避免跟真人在 OA 後台的回覆打架 */
  handoffSilenceHours: 12,

  /** 查單時要求客人提供的手機末幾碼 */
  phoneDigits: 3,

  /** 查單驗證失敗幾次就直接轉真人 */
  maxOrderAttempts: 2,
} as const;
