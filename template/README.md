# family-ai-chat-shell template (locked UI)

This folder is the **canonical** chat shell for Skill「Share Bot With Family」.

When running the skill, **copy this directory as-is**. Do **not** regenerate `public/index.html`, `public/app.js`, or `public/styles.css` with an LLM — every install must look the same.

Only customize at deploy time:
- Create a new D1 DB and put its `database_id` into `wrangler.toml`
- Optionally rename the Worker `name` if the account already has `family-ai-chat-shell`
- Set secrets: `ACCESS_PASS` (4 digits, system-generated), `WEBHOOK_URL`, `WEBHOOK_SECRET`, `REPLY_SECRET`

UI files (must ship unchanged):
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/_routes.json`
