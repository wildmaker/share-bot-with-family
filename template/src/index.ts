type MessageStatus = "pending" | "done";

type MessageRow = {
  id: string;
  session_key: string;
  name: string;
  question: string;
  reply: string | null;
  status: MessageStatus;
  created_at: number;
  updated_at: number;
};

type MessageResponse = {
  id: string;
  name: string;
  question: string;
  reply: string | null;
  status: MessageStatus;
  createdAt: number;
  updatedAt: number;
};

type CreateMessageBody = {
  name?: unknown;
  text?: unknown;
  pass?: unknown;
};

type ReplyBody = {
  id?: unknown;
  reply?: unknown;
};

const encoder = new TextEncoder();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: sameOriginHeaders() });
    }

    if (url.pathname === "/api/messages" && request.method === "POST") {
      return await createMessage(request, env, ctx, url);
    }

    if (url.pathname === "/api/messages" && request.method === "GET") {
      return await listMessages(url, env);
    }

    if (url.pathname === "/api/reply" && request.method === "POST") {
      return await saveReply(request, env);
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.code }, error.status);
    }

    console.error(JSON.stringify({ level: "error", message: "api_error", error: String(error) }));
    return json({ error: "server_error" }, 500);
  }
}

async function createMessage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const body = await readJson<CreateMessageBody>(request);
  const name = validateText(body.name, "name", 1, 40);
  const text = validateText(body.text, "text", 1, 1000);
  const pass = optionalText(body.pass, 120);

  const sessionKey = await getSessionKey(env, name, pass);
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO messages (id, session_key, name, question, reply, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)`,
  )
    .bind(id, sessionKey, name, text, now, now)
    .run();

  ctx.waitUntil(postWebhook(env, url, { messageId: id, sessionKey, name, text }).catch((error) => {
    console.error(JSON.stringify({ level: "error", message: "webhook_failed", id, error: String(error) }));
  }));

  return json({ id, status: "pending" }, 202);
}

async function listMessages(url: URL, env: Env): Promise<Response> {
  const name = validateText(url.searchParams.get("name"), "name", 1, 40);
  const pass = optionalText(url.searchParams.get("pass"), 120);
  const after = parseAfter(url.searchParams.get("after"));
  const sessionKey = await getSessionKey(env, name, pass);

  const query = after > 0
    ? env.DB.prepare(
      `SELECT id, session_key, name, question, reply, status, created_at, updated_at
       FROM messages
       WHERE session_key = ? AND (created_at > ? OR updated_at > ?)
       ORDER BY created_at ASC
       LIMIT 50`,
    ).bind(sessionKey, after, after)
    : env.DB.prepare(
      `SELECT id, session_key, name, question, reply, status, created_at, updated_at
       FROM (
         SELECT id, session_key, name, question, reply, status, created_at, updated_at
         FROM messages
         WHERE session_key = ?
         ORDER BY created_at DESC
         LIMIT 30
       )
       ORDER BY created_at ASC`,
    ).bind(sessionKey);

  const result = await query.all<MessageRow>();
  return json({ messages: result.results.map(toMessageResponse) });
}

async function saveReply(request: Request, env: Env): Promise<Response> {
  if (!env.REPLY_SECRET) {
    return json({ error: "reply_secret_not_configured" }, 500);
  }

  const headerName = env.REPLY_SECRET_HEADER || "Authorization";
  const providedSecret = request.headers.get(headerName) || "";
  if (!safeEqual(providedSecret, env.REPLY_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await readJson<ReplyBody>(request);
  const id = validateText(body.id, "id", 1, 80);
  const reply = validateText(body.reply, "reply", 1, 4000);
  const now = Date.now();

  const result = await env.DB.prepare(
    `UPDATE messages
     SET reply = ?, status = 'done', updated_at = ?
     WHERE id = ?`,
  )
    .bind(reply, now, id)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: "message_not_found" }, 404);
  }

  return json({ id, status: "done" });
}

async function postWebhook(
  env: Env,
  requestUrl: URL,
  message: { messageId: string; sessionKey: string; name: string; text: string },
): Promise<void> {
  if (!env.WEBHOOK_URL) {
    console.warn(JSON.stringify({ level: "warn", message: "webhook_url_not_configured", id: message.messageId }));
    return;
  }

  const replyUrl = new URL("/api/reply", requestUrl.origin).toString();
  const headers = new Headers({ "content-type": "application/json" });

  if (env.WEBHOOK_SECRET) {
    headers.set(env.WEBHOOK_SECRET_HEADER || "Authorization", env.WEBHOOK_SECRET);
  }

  const response = await fetch(env.WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messageId: message.messageId,
      sessionKey: message.sessionKey,
      name: message.name,
      text: message.text,
      replyUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook responded ${response.status}`);
  }
}

async function getSessionKey(env: Env, name: string, pass: string | undefined): Promise<string> {
  const normalizedName = name.trim().toLocaleLowerCase();

  if (!env.ACCESS_PASS) {
    throw new HttpError(503, "access_pass_not_configured");
  }

  if (!pass || !safeEqual(pass, env.ACCESS_PASS)) {
    throw new HttpError(401, "access_pass_required");
  }

  return sha256Hex(`locked:${pass}:${normalizedName}`);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  if (actualBytes.byteLength !== expectedBytes.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(actualBytes, expectedBytes);
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "json_required");
  }

  try {
    return await request.json<T>();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function validateText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${field}_required`);
  }

  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new HttpError(400, `${field}_required`);
  }

  if (trimmed.length > max) {
    throw new HttpError(400, `${field}_too_long`);
  }

  return trimmed;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_pass");
  }

  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new HttpError(400, "pass_too_long");
  }

  return trimmed || undefined;
}

function parseAfter(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "invalid_after");
  }

  return parsed;
}

function toMessageResponse(row: MessageRow): MessageResponse {
  return {
    id: row.id,
    name: row.name,
    question: row.question,
    reply: row.reply,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: sameOriginHeaders(),
  });
}

function sameOriginHeaders(): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
