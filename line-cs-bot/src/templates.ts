// 客人會看到的所有字都在這裡。AI 不會自己寫回覆，只會從這裡挑一句、把資料填進去。
// 請由同仁審核、改成你們平常的口吻。每類放多句，系統會輪流挑，比較不像機器人。
// {expected}、{latest} 會換成時間說法，例如「明天（週二）早上 11 點」。

export const TEMPLATES = {
  /** 藥效、藥性、身體狀況等專業問題 */
  medicalAck: [
    "收到您的問題了🙏 這部分我先幫您轉給我們的醫療同仁確認，預計{expected}前回覆您，最晚{latest}前一定會回覆喔！",
    "您好，謝謝您的詢問～這題需要醫療同仁協助說明，我已經幫您轉達了，大約{expected}會回覆您，最晚不會超過{latest}，再請您稍等一下🙏",
    "了解～為了給您正確的說明，我先幫您轉給後端的專業小編，預計{expected}回覆，最晚{latest}前會跟您聯繫喔！",
  ],

  /** 非上班時間收到的一般問題 */
  offHoursAck: [
    "您好～現在是非服務時段，訊息已經收到了，同仁{expected}上線後會優先回覆您喔🙏",
    "收到您的訊息了！目前同仁暫時不在線上，{expected}會盡快回覆您，謝謝您的耐心～",
  ],

  /** 想查訂單但還沒給資料 */
  askOrderInfo: [
    "好的，幫您查詢訂單～麻煩提供「訂單編號」和「訂購手機末 3 碼」，例如：20261019001 / 678",
    "沒問題！請給我「訂單編號」以及「訂購手機末 3 碼」，我馬上幫您查🙏",
  ],

  /** 訂單編號或手機末碼對不上 */
  orderNotMatched: [
    "抱歉，這組資料我這邊查不到對應的訂單😥 麻煩再確認一下訂單編號和手機末 3 碼，或直接回覆，我請同仁幫您確認～",
  ],

  /** 多次對不上，轉真人 */
  orderHandoff: [
    "不好意思讓您久等了，這筆訂單我請同仁直接幫您確認，{expected}前會回覆您喔🙏",
  ],

  /** 查單系統出錯 */
  orderSystemError: [
    "抱歉，系統這邊暫時查不到資料，我已經請同仁幫您確認，會盡快回覆您🙏",
  ],
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function pick(key: TemplateKey, vars: Record<string, string> = {}, seed = Date.now()): string {
  const list = TEMPLATES[key];
  const text = list[Math.abs(seed) % list.length];
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
