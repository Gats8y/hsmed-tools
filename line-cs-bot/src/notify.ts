// 通知同仁「有客人需要真人回覆」。支援 Slack / Discord / Google Chat 的 incoming webhook。
// 沒設定 STAFF_WEBHOOK_URL 就只寫 log。

export interface StaffAlert {
  reason: string;
  userId: string;
  text: string;
}

export async function notifyStaff(url: string | undefined, kind: string | undefined, alert: StaffAlert) {
  const message = `【LINE 客服需要真人】${alert.reason}\n客人 ID：${alert.userId}\n訊息：${alert.text}\n請到 LINE OA 後台聊天室回覆。`;
  if (!url) {
    console.log(message);
    return;
  }
  const payload = kind === "discord" ? { content: message } : { text: message };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("staff notify failed", res.status, await res.text());
}
