# Share Bot With Family

Grok Bot Skill：让家人用网页 + 系统生成的 4 位数字口令，和你的指定 Bot 聊天（走你的订阅 Token，不用给家人开会员）。

## 结构

- `SKILL.md` — 三阶段工作流（准备 → 选 Bot → 建 webhook 并交付链接/口令）
- `template/` — **锁定**的 `family-ai-chat-shell`（Cloudflare Worker + D1 + 固定 UI「家人问问 AI」）

部署时必须**原样拷贝** `template/`，禁止用模型重写 `public/` 页面。

## 快速开始

在 Grok Bot 中安装/引用本 Skill，然后说：「帮我把某某 Bot 分享给家人」。

详见 `SKILL.md` 与 `template/INTERFACE.md`。

## License

MIT
