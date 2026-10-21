# LINE 官方帳號 AI 客服（第一版）

Cloudflare Worker：接收 LINE webhook → Claude 只做「分類」→ 依時段與類別回覆固定模板 → 需要真人時通知同仁。
客人看到的字都在 `src/templates.ts`，營運規則在 `src/config.ts`。

## 分流規則

| 類別 | 上班時段 | 非上班時段 |
|---|---|---|
| 藥效／身體狀況 | 回「已轉達醫療同仁」＋預計／最晚回覆時間，通知同仁 | 同左 |
| 查訂單 | 要訂單編號＋手機末 3 碼 → SHOPLINE 唯讀查詢 → 回固定格式 | 同左 |
| 其他 | **AI 不回**，由同仁在 LINE OA 後台回 | 回「已收到，X 點回覆」，通知同仁 |

- AI 回過「已轉達」後，對同一位客人靜音 12 小時，避免跟 OA 後台的真人回覆重複。
- AI 出錯、拒答或輸出格式不對 → 一律當「其他」處理。
- 抽出的訂單編號必須在客人原文中出現，否則丟掉。

## SHOPLINE 設定

- 向 SHOPLINE 窗口申請 OpenAPI，到「設定 > 管理員設定」新增專用管理員 → API Auth，只勾 Search Orders。
- 不設 IP 白名單（Cloudflare Workers 沒有固定對外 IP）；建議設 token 到期日。

## 部署

```bash
npm install
npx wrangler kv namespace create STATE   # 把 id 貼進 wrangler.toml
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SHOPLINE_ACCESS_TOKEN
npx wrangler secret put STAFF_WEBHOOK_URL       # 選填：Slack / Discord / Google Chat
npx wrangler deploy
```

部署後把 Worker 網址填到 LINE Developers → Messaging API → Webhook URL。
**填之前先記下原本的 Webhook URL**，填到 `FORWARD_WEBHOOK_URLS`，原本的串接（例如 SHOPLINE 的 LINE 串接）才不會斷。

LINE OA Manager → 回應設定：「聊天」與「Webhook」都開啟，關閉「自動回應訊息」避免重複回覆。

## 測試

```bash
npm test        # 模擬資料跑全部情境
npm run typecheck
```
