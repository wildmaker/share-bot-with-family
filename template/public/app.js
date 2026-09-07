const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 180000;
const STORAGE_KEY = "family-ai-chat.identity";

const nameInput = document.querySelector("#name-input");
const passInput = document.querySelector("#pass-input");
const questionInput = document.querySelector("#question-input");
const form = document.querySelector("#message-form");
const sendButton = document.querySelector("#send-button");
const messageList = document.querySelector("#message-list");
const statusLine = document.querySelector("#status-line");

const state = {
  messages: new Map(),
  pendingSince: new Map(),
  pollTimer: undefined,
  loadingHistory: false,
};

loadIdentity();
render();

nameInput.addEventListener("change", () => {
  saveIdentity();
  void loadHistory();
});

passInput.addEventListener("change", () => {
  saveIdentity();
  void loadHistory();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendQuestion();
});

if (nameInput.value.trim() && passInput.value.trim()) {
  void loadHistory();
}

async function sendQuestion() {
  const name = nameInput.value.trim();
  const pass = passInput.value.trim();
  const text = questionInput.value.trim();

  if (!name) {
    setStatus("先写上你的名字，家人才知道是谁问的。");
    nameInput.focus();
    return;
  }

  if (!pass) {
    setStatus("请填写家庭口令，才能发送问题。");
    passInput.focus();
    return;
  }

  if (!text) {
    setStatus("问题还空着呢，写一句想问的内容吧。");
    questionInput.focus();
    return;
  }

  saveIdentity();
  const tempId = `local-${crypto.randomUUID()}`;
  const now = Date.now();
  state.messages.set(tempId, {
    id: tempId,
    name,
    question: text,
    reply: null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    local: true,
  });
  state.pendingSince.set(tempId, now);
  questionInput.value = "";
  setSending(true);
  setStatus("已发送，机器人正在想...");
  render();
  scrollToBottom();

  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, text, pass: pass || undefined }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(errorCopy(payload.error));
    }

    const message = state.messages.get(tempId);
    state.messages.delete(tempId);
    state.pendingSince.delete(tempId);
    state.messages.set(payload.id, {
      ...message,
      id: payload.id,
      status: payload.status,
      local: false,
    });
    state.pendingSince.set(payload.id, now);
    setStatus("已发送，稍等片刻会自动刷新回答。");
    startPolling();
  } catch (error) {
    const failed = state.messages.get(tempId);
    if (failed) {
      state.messages.set(tempId, {
        ...failed,
        status: "failed",
        reply: "发送没有成功，请检查名字、口令或稍后再试。",
        updatedAt: Date.now(),
      });
      state.pendingSince.delete(tempId);
    }
    setStatus(error instanceof Error ? error.message : "发送失败，请稍后再试。");
  } finally {
    setSending(false);
    render();
    scrollToBottom();
  }
}

async function loadHistory() {
  const name = nameInput.value.trim();
  const pass = passInput.value.trim();
  if (state.loadingHistory) {
    return;
  }

  if (!name || !pass) {
    setStatus("填好名字和家庭口令后，会自动读取最近记录。");
    return;
  }

  state.loadingHistory = true;
  setStatus("正在读取最近的聊天记录...");

  try {
    const messages = await fetchMessages();
    state.messages.clear();
    state.pendingSince.clear();
    for (const message of messages) {
      state.messages.set(message.id, message);
      if (message.status === "pending") {
        state.pendingSince.set(message.id, message.createdAt);
      }
    }
    setStatus(messages.length ? "最近记录已加载。" : "还没有聊天记录，发出第一个问题吧。");
    render();
    scrollToBottom();
    if (hasPending()) {
      startPolling();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "聊天记录读取失败。");
  } finally {
    state.loadingHistory = false;
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(() => {
    void pollReplies();
  }, POLL_INTERVAL_MS);
  void pollReplies();
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = undefined;
  }
}

async function pollReplies() {
  if (!hasPending()) {
    stopPolling();
    return;
  }

  const timedOut = [...state.pendingSince.entries()].filter(([, startedAt]) => {
    return Date.now() - startedAt > POLL_TIMEOUT_MS;
  });

  for (const [id] of timedOut) {
    const message = state.messages.get(id);
    if (message?.status === "pending") {
      state.messages.set(id, {
        ...message,
        status: "timeout",
        reply: "这次等得有点久。可以稍后刷新看看，或重新发一次问题。",
        updatedAt: Date.now(),
      });
      state.pendingSince.delete(id);
    }
  }

  if (!hasPending()) {
    setStatus("等待时间有点久，先帮你保留问题。");
    stopPolling();
    render();
    return;
  }

  try {
    const messages = await fetchMessages();
    for (const message of messages) {
      state.messages.set(message.id, message);
      if (message.status === "done") {
        state.pendingSince.delete(message.id);
      }
    }
    setStatus(hasPending() ? "机器人正在想..." : "回答已更新。");
    render();
    scrollToBottom();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "刷新回答失败，稍后会再试。");
  }
}

async function fetchMessages() {
  const name = nameInput.value.trim();
  const pass = passInput.value.trim();
  const params = new URLSearchParams({ name });
  params.set("pass", pass);

  const response = await fetch(`/api/messages?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(errorCopy(payload.error));
  }

  return payload.messages;
}

function render() {
  const messages = [...state.messages.values()].sort((a, b) => a.createdAt - b.createdAt);
  messageList.textContent = "";

  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>今天想问点什么？</strong><span>可以问健康小知识、做饭灵感、旅行安排，或让机器人帮忙解释复杂事情。</span>";
    messageList.append(empty);
    return;
  }

  for (const message of messages) {
    appendBubble("user", message.question, message.status === "pending" ? "已发送" : "已发送");

    if (message.reply) {
      appendBubble("assistant", message.reply, message.status === "done" ? "已回复" : "提示");
    } else if (message.status === "pending") {
      appendBubble("assistant", "正在想", "请稍等", true);
    }
  }
}

function appendBubble(role, text, meta, thinking = false) {
  const row = document.createElement("div");
  row.className = `bubble-row ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const content = document.createElement("span");
  content.textContent = text;
  if (thinking) {
    content.className = "thinking";
  }

  const details = document.createElement("span");
  details.className = "meta";
  details.textContent = meta;

  bubble.append(content, details);
  row.append(bubble);
  messageList.append(row);
}

function hasPending() {
  return [...state.messages.values()].some((message) => message.status === "pending");
}

function setSending(isSending) {
  sendButton.disabled = isSending;
  sendButton.textContent = isSending ? "发送中" : "发送";
}

function setStatus(message) {
  statusLine.textContent = message;
}

function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
}

function loadIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    nameInput.value = typeof saved.name === "string" ? saved.name : "";
    passInput.value = typeof saved.pass === "string" ? saved.pass : "";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveIdentity() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      name: nameInput.value.trim(),
      pass: passInput.value.trim(),
    }),
  );
}

function errorCopy(code) {
  const copies = {
    access_pass_not_configured: "服务器还没有配置家庭口令，暂时不能读取或发送消息。",
    access_pass_required: "家庭口令不正确，确认后再试一次。",
    invalid_json: "请求格式不正确。",
    json_required: "请求需要 JSON 格式。",
    name_required: "请先填写名字。",
    text_required: "请写下想问的问题。",
    text_too_long: "问题太长了，先精简一下再发送。",
    pass_too_long: "家庭口令太长了。",
    reply_secret_not_configured: "服务器还没有配置回复密钥。",
    server_error: "服务器刚刚开小差了，请稍后再试。",
  };

  return copies[code] || "操作没有成功，请稍后再试。";
}
