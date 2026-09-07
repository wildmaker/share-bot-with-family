# API Interface

Base URL: same origin as the deployed page.

All request and response bodies are JSON. Client requests do not need CORS because the page and API are same-origin.

## Environment and secrets

Server-side only:

| Name | Required | Purpose |
| --- | --- | --- |
| `WEBHOOK_URL` | Yes in production | Cursor/Grok Bot routine webhook URL. |
| `WEBHOOK_SECRET` | If webhook requires it | Sent to the webhook in `WEBHOOK_SECRET_HEADER`. |
| `WEBHOOK_SECRET_HEADER` | No | Non-secret header name. Defaults to `Authorization`; configured in `wrangler.toml`. |
| `REPLY_SECRET` | Yes | Shared secret required by `POST /api/reply`. |
| `REPLY_SECRET_HEADER` | No | Non-secret header name. Defaults to `Authorization`; configured in `wrangler.toml`. |
| `ACCESS_PASS` | Yes | Exactly 4 digits. Message reads/writes are disabled until configured correctly. |
| `BOT_NAME` | No | Public Bot display name. Defaults to `Grok`. |
| `BOT_AVATAR_URL` | No | Public HTTPS or same-origin avatar URL. Defaults to `/bot-avatar.svg`. |

Secrets are never returned to the frontend.

## `GET /api/config`

Returns the public Bot identity used by the access and chat screens.

```json
{
  "botName": "旅行助手",
  "botAvatarUrl": "https://example.com/travel-bot.png"
}
```

Invalid or missing avatar configuration falls back to the bundled Grok-style triangle avatar. The browser also applies this fallback if the configured image fails to load.

## `POST /api/session`

Verifies the 4-digit sharing passcode before the chat UI opens.

```json
{
  "pass": "0427"
}
```

On success it returns `200 OK` with `{ "ok": true, "botName": "...", "botAvatarUrl": "..." }`.

## `POST /api/messages`

Create a pending question and fire-and-forget a webhook request.

### Request

```http
POST /api/messages
Content-Type: application/json
```

```json
{
  "text": "今天晚饭吃什么？",
  "pass": "0427"
}
```

Fields:

- `name` string, optional, 1-40 trimmed characters. Defaults to `家人`.
- `text` string, required, 1-1000 trimmed characters.
- `pass` string, required. Must be 4 digits and match server `ACCESS_PASS`.

### Response

Status: `202 Accepted`

```json
{
  "id": "3b985f20-5422-40bb-b3fd-6b6692a4d845",
  "status": "pending"
}
```

### Webhook payload sent by Worker

The Worker sends this payload to `WEBHOOK_URL` after inserting the D1 row:

```json
{
  "messageId": "3b985f20-5422-40bb-b3fd-6b6692a4d845",
  "sessionKey": "sha256-session-key",
  "name": "妈妈",
  "text": "今天晚饭吃什么？",
  "replyUrl": "https://your-domain.example/api/reply"
}
```

If `WEBHOOK_SECRET` is set, the Worker includes it exactly as configured:

```http
Authorization: Bearer your-secret
```

or with a custom header name:

```http
X-Webhook-Key: your-secret
```

## `GET /api/messages`

List recent messages for one identity. Used for history and polling.

### Request

```http
GET /api/messages?pass=0427&after=1720000000000
```

Query parameters:

- `name` string, optional, 1-40 trimmed characters. Defaults to `家人`.
- `pass` string, required. Must be 4 digits and match server `ACCESS_PASS`.
- `after` integer milliseconds timestamp, optional. If set, returns rows whose `created_at` or `updated_at` is greater than this value. If omitted, returns the latest 30 rows for the identity.

### Response

Status: `200 OK`

```json
{
  "messages": [
    {
      "id": "3b985f20-5422-40bb-b3fd-6b6692a4d845",
      "name": "妈妈",
      "question": "今天晚饭吃什么？",
      "reply": "可以做番茄鸡蛋面，简单暖胃。",
      "status": "done",
      "createdAt": 1720000000000,
      "updatedAt": 1720000005000
    }
  ]
}
```

`status` is either:

- `pending`: question stored, waiting for assistant reply.
- `done`: reply saved.

## `POST /api/reply`

Server-to-server endpoint for Cursor/Grok Bot routine write-back.

### Request

```http
POST /api/reply
Content-Type: application/json
Authorization: your-reply-secret
```

```json
{
  "id": "3b985f20-5422-40bb-b3fd-6b6692a4d845",
  "reply": "可以做番茄鸡蛋面，简单暖胃。"
}
```

Fields:

- `id` string, required. Must match a message id from `POST /api/messages`.
- `reply` string, required, 1-4000 trimmed characters.

The secret header name defaults to `Authorization` and can be changed with `REPLY_SECRET_HEADER`.

### Response

Status: `200 OK`

```json
{
  "id": "3b985f20-5422-40bb-b3fd-6b6692a4d845",
  "status": "done"
}
```

## Error responses

Errors use this shape:

```json
{
  "error": "access_pass_required"
}
```

Common status codes:

- `400`: missing or invalid fields.
- `401`: missing/wrong client `pass`, or wrong `REPLY_SECRET`.
- `404`: route or message id not found.
- `415`: request body must be JSON.
- `500`: reply endpoint missing `REPLY_SECRET`, or storage error.
- `503`: `ACCESS_PASS` is missing or is not exactly 4 digits, so message reads/writes are disabled.
