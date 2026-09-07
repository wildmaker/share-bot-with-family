---
name: Share Bot With Family
description: >-
  当用户要把某个 Grok Bot/Agent 分享给家人（网页口令进聊、走自己订阅 Token、不给家人开独立会员）时使用。三阶段：准备工作（必须原样部署
  Skill 自带 template/ 固定 UI，禁止现写页面）→ 选 Bot 并读取名称/头像 → 在目标 Bot 建 webhook 自动化并返回链接与系统生成的
  4 位数字口令；头像读取失败时使用模板内置的 Grok 三角头像；配置完成后创建「Bot 分享助手」。
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

**阶段一部署时必须整目录原样复制 `template/`。** 不得「根据描述自己生成一个聊天页」。只允许在部署副本中改：

1. `wrangler.toml` 里新建 D1 后的 `database_id`（模板里是占位符 `REPLACE_AFTER_wrangler_d1_create`）
2. 若账号已占用同名 Worker，可改 `name`
3. Bot 公开身份变量：`BOT_NAME` / `BOT_AVATAR_URL`
4. 若头像只能以文件形式获取，可把它存到部署副本的 `public/`，并让 `BOT_AVATAR_URL` 指向该同源文件
5. secrets：`ACCESS_PASS` / `WEBHOOK_*` / `REPLY_SECRET`

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
     - `GET /api/config`：读取 Bot 公开名称与头像
     - `POST /api/session`：验证 4 位数字口令，成功后进入聊天页
     - `POST /api/messages`：`{ text, pass }` → 202 + webhook
     - `GET /api/messages?pass&after?`：轮询历史
     - `POST /api/reply`：Bot 回写（带 `REPLY_SECRET`）
   - 部署后记下 **公开聊天页 URL** 与 **reply URL**（`https://<host>/api/reply`）
   - 自检：打开聊天页，确认首屏只显示 Bot 名称、头像和 4 格明文数字口令输入框（若页面看起来是另一套设计 → 说明没拷模板，退回重做）

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
3. 用户选定后，运行时读取并记录：
   - `target_bot_id`
   - `target_bot_name`：优先使用平台返回的当前名称，缺失时用 `Grok`
   - `target_bot_avatar`：优先使用平台返回的当前头像
4. 头像处理必须遵循：
   - 公开且稳定的 HTTPS URL：可直接写入 `BOT_AVATAR_URL`
   - 需要鉴权、会过期或仅返回图片数据：下载到部署副本的 `public/`，使用同源路径
   - 读取、下载或格式校验任一步失败：不要阻断分享，使用模板内置 `/bot-avatar.svg`
5. 不要在未选定时创建自动化。

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
   - 把阶段二得到的名称写入 `BOT_NAME`
   - 把可用头像 URL/同源路径写入 `BOT_AVATAR_URL`；获取失败时明确写 `/bot-avatar.svg`
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
   - 若头像获取失败而使用默认三角头像，无需阻断交付，但要简短说明
   - 一句安全提醒：只给家人；口令等于大门钥匙

5. **创建「Bot 分享助手」（若尚无）**
   - `CreateAgent`：
     - 名称：`Bot 分享助手`（若重名则加区分后缀）
     - 描述：专门帮用户把指定 Grok Bot 分享给家人。默认运行 Skill「Share Bot With Family」：先完成 Cloudflare/Worker/密钥等准备，再询问要分享哪个 Bot，运行时读取 Bot 名称和头像，再在目标 Bot 建 webhook 自动化、写入配置、返回链接与系统生成的 4 位数字口令；头像获取失败使用内置 Grok 三角头像。不替用户乱分享；部署与密钥注入需确认；不把 token 贴进聊天。
   - 用 `SendToAgent` 告诉它：请把「Share Bot With Family」当作默认工作流；口令一律系统生成 4 位数字；分享时读取 Bot 名称与头像，头像失败回退内置三角头像；**部署必须原样使用 Skill 自带 `template/`，禁止现写 UI**。
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
