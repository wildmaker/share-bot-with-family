---
name: Share Bot With Family
description: >-
  当用户要把某个 Grok Bot/Agent 分享给家人（网页口令进聊、走自己订阅 Token、不给家人开独立会员）时使用。三阶段：准备工作（必须原样部署
  Skill 自带 template/ 固定 UI，禁止现写页面）→ 选要分享的 Bot → 在目标 Bot 建 webhook 自动化并返回链接与系统生成的
  4 位数字口令；配置完成后创建「Bot 分享助手」。
---
# Share Bot With Family

让家人用网页 + 4 位数字口令「穿越」到指定 Grok Bot 聊天。全程走主人订阅 Token；口令**必须由系统自动生成**，禁止让用户自拟口令。

参考实现：Cloudflare Worker + D1 中转壳（Pages/Assets 同域气泡页），Worker **不跑模型**；家人发消息 → Worker 存库并 webhook 叫醒目标 Bot → Bot 答完 `POST /api/reply` 回写。已验证云端 webhook 可叫醒助手，不依赖本机公网 IP。

## 固定 UI 模板（强制）

本 Skill 目录旁有 **`template/`**（与 `SKILL.md` 同级）。这是**唯一允许部署的聊天壳**，来自已验证的 `family-ai-chat-shell` / `fqac`：

- UI（**禁止改文案/样式/结构，禁止用模型重写**）：
  - `template/public/index.html`
  - `template/public/app.js`
  - `template/public/styles.css`
  - `template/public/_routes.json`
- Worker / 配置：`template/src/index.ts`、`template/wrangler.toml`、`template/migrations/`、`template/package.json`、`template/INTERFACE.md`

**阶段一部署时必须整目录原样复制 `template/`。** 不得「根据描述自己生成一个聊天页」。只允许改：

1. `wrangler.toml` 里新建 D1 后的 `database_id`（模板里是占位符 `REPLACE_AFTER_wrangler_d1_create`）
2. 若账号已占用同名 Worker，可改 `name`
3. secrets：`ACCESS_PASS` / `WEBHOOK_*` / `REPLY_SECRET`

否则不同用户 run 出来的页面会不一致，这是缺陷，不是特性。

硬约束：
- 只分享给不会瞎搞的家人（消息几乎未过滤直达 Bot）
- 密钥不进浏览器；`ACCESS_PASS` / `WEBHOOK_*` / `REPLY_SECRET` 只在 Worker secrets
- 不做多租户账号系统
- 对外部署、改别人账号、代发消息前必须用户确认；不要把 API token 贴进聊天，用 secret-request / 安全注入

---

## 阶段一：完成所有准备工作

按顺序做完再进入阶段二。缺项就停在阶段一并告诉用户差什么。

1. **确认本机/助手侧能力**
   - 能创建/更新 routine（webhook 触发）
   - 能 `CreateAgent` / `SendToAgent`（配置结束后要建「Bot 分享助手」）
   - 能把本 Skill 的 `template/` 拷到可部署目录（如用户机上的项目文件夹）

2. **Cloudflare 与代码壳（只用捆绑模板）**
   - 用户已有 Cloudflare 账号；本机有 `wrangler`（或指导安装到用户目录，如 `~/.local`，避免系统包）
   - **复制本 Skill 的 `template/` 全文**到工作目录（不要手写 UI，不要从别处另起炉灶）
   - `wrangler d1 create` 新建库 → 填入 `wrangler.toml` 的 `database_id` → `migrations apply` → `wrangler deploy`
   - 关键 API 以 `template/INTERFACE.md` 为准（同域）：
     - `POST /api/messages`：`{ name, text, pass }` → 202 + webhook
     - `GET /api/messages?name&pass&after?`：轮询历史
     - `POST /api/reply`：Bot 回写（带 `REPLY_SECRET`）
   - 部署后记下 **公开聊天页 URL** 与 **reply URL**（`https://<host>/api/reply`）
   - 自检：打开聊天页，确认标题为「家人问问 AI」、样式与模板一致（若页面看起来是另一套设计 → 说明没拷模板，退回重做）

3. **生成密钥材料（全部系统生成，勿问用户要口令）**
   - `ACCESS_PASS`：恰好 **4 位数字**（`0000`–`9999`，均匀随机；可允许前导零）
   - `REPLY_SECRET`：长随机串
   - `WEBHOOK_SECRET`：长随机串（若平台 webhook 需要）
   - 写入 Worker secrets / `.dev.vars`（本地），**永远不要**把完整 secret 写进 Skill 记忆或公开文档；对用户只展示 `ACCESS_PASS` 与聊天页链接

4. **Webhook 可达性**
   - 确认目标平台支持「外部 webhook 叫醒 routine」
   - 记下后续要填的 `WEBHOOK_URL`（阶段三在目标 Bot 创建 routine 后填入 Worker）

准备检查清单全部勾完 → 进入阶段二。

---

## 阶段二：询问用户要共享哪个 Bot

1. 列出当前用户可见的 Bots/Agents（名称 + 一句话职责；排除已是「Bot 分享助手」的实例除非用户点名）。
2. 用问题组件让用户选一个（选项必须是真实存在的 Bot；不确定就先查再问）。
3. 用户选定后，记录：`target_bot_id`、`target_bot_name`。不要在未选定时创建自动化。

---

## 阶段三：在对应 Bot 中创建自动化并完成分享配置

在**被分享的那个 Bot**上完成，不要配错对象。

1. **在目标 Bot 创建 webhook routine**
   - 名称示例：`家人问答 webhook` / `Share Bot With Family webhook`
   - 触发：webhook
   - Prompt 意图（写给未来的自己，不要写死易变工具细节）：
     - 解析 webhook 载荷：`messageId`、`name`、`text`、`replyUrl`（及可选 `sessionKey`）
     - 以目标 Bot 身份回答家人问题（简洁、口语、适合非技术家人）
     - 回答后 `POST` 到 `replyUrl`（或配置的 `/api/reply`），带上 `REPLY_SECRET`，body：`{ "id": messageId, "reply": "..." }`
     - 不要把密钥回显给家人聊天页；失败时在主人对话里简短报错

2. **把 Worker 接到这条 routine**
   - 将 routine 的 `WEBHOOK_URL`（及如需要的 `WEBHOOK_SECRET`）写入 Worker 环境
   - 确认 `ACCESS_PASS` 已是阶段一生成的 4 位数字
   - `REPLY_SECRET` 与 routine 回写一致
   - 热更新：改 Bot 人设/技能后无需重新发版家人页（UI 仍必须保持模板原样）

3. **端到端自测（最短路径）**
   - 用聊天页 + 口令发一条测试消息
   - 确认目标 Bot 被叫醒并回写，页面出现回复
   - 失败则修配置，不要把半成品链接当交付

4. **向用户交付**
   - 聊天页链接
   - **4 位数字口令**（系统生成的那个）
   - 被分享的 Bot 名称
   - 一句安全提醒：只给家人；口令等于大门钥匙

5. **创建「Bot 分享助手」（若尚无）**
   - `CreateAgent`：
     - 名称：`Bot 分享助手`（若重名则加区分后缀）
     - 描述：专门帮用户把指定 Grok Bot 分享给家人。默认运行 Skill「Share Bot With Family」：先完成 Cloudflare/Worker/密钥等准备，再询问要分享哪个 Bot，再在目标 Bot 建 webhook 自动化、写入配置、返回链接与系统生成的 4 位数字口令。不替用户乱分享；部署与密钥注入需确认；不把 token 贴进聊天。
   - 用 `SendToAgent` 告诉它：请把「Share Bot With Family」当作默认工作流；口令一律系统生成 4 位数字；**部署必须原样使用 Skill 自带 `template/`，禁止现写 UI**。
   - 若助手已存在：跳过创建，只确保它知道使用本 Skill。

6. **收尾**
   - 在执行助手自己的 log 记一句：哪个 Bot 已分享、Worker 主机名、口令已交付（不要存完整 `REPLY_SECRET`/`WEBHOOK_SECRET`）
   - 告诉用户：以后改分享对象或再分享，直接找「Bot 分享助手」或对本助手说「把某某 Bot 分享给家人」

---

## 用户说法示例

- 「帮我把某某 Bot 分享给家人」
- 「跑一下 Share Bot With Family」
- 「给家里人开一个能聊我新闻助理的网页」

## 不要做的事

- 让用户自己想口令或改成非 4 位数字
- 在未完成准备时跳到建 routine
- 把 Cloudflare API token / 长 secret 写进聊天或公开 Skill 正文
- 把官方「建模版 + 家人自己买会员」当成默认方案（本 Skill 就是为了避开那条路径）
- **用模型重新生成聊天页 HTML/CSS/JS，或从零「设计一版更好的 UI」**（必须用捆绑 `template/public/`）
