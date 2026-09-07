const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 180000;
const DEFAULT_BOT_NAME = "Grok";
const DEFAULT_BOT_AVATAR = "/bot-avatar.svg";

const accessScreen = document.querySelector("#access-screen");
const accessForm = document.querySelector("#access-form");
const accessStatus = document.querySelector("#access-status");
const passcodeFields = document.querySelector("#passcode-fields");
const passInputs = [...document.querySelectorAll("[data-pass-index]")];
const chatScreen = document.querySelector("#chat-screen");
const questionInput = document.querySelector("#question-input");
const form = document.querySelector("#message-form");
const sendButton = document.querySelector("#send-button");
const messageList = document.querySelector("#message-list");
const emptyState = document.querySelector("#empty-state");
const statusLine = document.querySelector("#status-line");

const state = {
  accessPass: "",
  authenticated: false,
  authenticating: false,
  botName: DEFAULT_BOT_NAME,
  botAvatarUrl: DEFAULT_BOT_AVATAR,
  messages: new Map(),
  messageElements: new Map(),
  pendingSince: new Map(),
  pollTimer: undefined,
  polling: false,
  loadingHistory: false,
  sending: false,
};

void loadBotConfig();
setupPasscode();
setupAvatarFallbacks();
updateSendButton();

accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void unlockChat();
});

questionInput.addEventListener("input", () => {
  resizeComposer();
  updateSendButton();
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendQuestion();
});

async function loadBotConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }

    applyBotConfig(await response.json());
  } catch {
    applyBotConfig({});
  }
}

function applyBotConfig(config) {
  state.botName =
    typeof config.botName === "string" && config.botName.trim()
      ? config.botName.trim()
      : DEFAULT_BOT_NAME;
  state.botAvatarUrl =
    typeof config.botAvatarUrl === "string" && config.botAvatarUrl.trim()
      ? config.botAvatarUrl.trim()
      : DEFAULT_BOT_AVATAR;

  document.title = `${state.botName} · 家人分享`;
  document.querySelectorAll("[data-bot-name]").forEach((element) => {
    element.textContent = state.botName;
  });
  document.querySelectorAll("[data-bot-avatar]").forEach((image) => {
    setAvatarSource(image, state.botAvatarUrl);
  });
  questionInput.placeholder = `问问 ${state.botName}`;
}

function setupAvatarFallbacks() {
  document.querySelectorAll("[data-bot-avatar]").forEach((image) => {
    image.addEventListener("error", () => setAvatarSource(image, DEFAULT_BOT_AVATAR));
  });
}

function setAvatarSource(image, source) {
  const nextSource = source || DEFAULT_BOT_AVATAR;
  if (image.getAttribute("src") !== nextSource) {
    image.setAttribute("src", nextSource);
  }
}

function setupPasscode() {
  for (const input of passInputs) {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.passIndex);
      const digits = input.value.replace(/\D/g, "");
      input.value = digits.slice(-1);
      clearAccessError();

      if (input.value && index < passInputs.length - 1) {
        passInputs[index + 1].focus();
      }

      if (readPasscode().length === passInputs.length) {
        queueMicrotask(() => void unlockChat());
      }
    });

    input.addEventListener("keydown", (event) => {
      const index = Number(input.dataset.passIndex);
      if (event.key === "Backspace" && !input.value && index > 0) {
        passInputs[index - 1].value = "";
        passInputs[index - 1].focus();
      } else if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        passInputs[index - 1].focus();
      } else if (event.key === "ArrowRight" && index < passInputs.length - 1) {
        event.preventDefault();
        passInputs[index + 1].focus();
      }
    });
  }

  passcodeFields.addEventListener("paste", (event) => {
    const digits = event.clipboardData?.getData("text").replace(/\D/g, "").slice(0, 4) || "";
    if (!digits) {
      return;
    }

    event.preventDefault();
    digits.split("").forEach((digit, index) => {
      passInputs[index].value = digit;
    });
    passInputs[Math.min(digits.length, passInputs.length) - 1].focus();
    clearAccessError();
    if (digits.length === passInputs.length) {
      queueMicrotask(() => void unlockChat());
    }
  });
}

function readPasscode() {
  return passInputs.map((input) => input.value).join("");
}

async function unlockChat() {
  const pass = readPasscode();
  if (state.authenticating || state.authenticated) {
    return;
  }

  if (!/^\d{4}$/.test(pass)) {
    showAccessError("请输入完整的 4 位数字口令");
    passInputs.find((input) => !input.value)?.focus();
    return;
  }

  state.authenticating = true;
  passcodeFields.setAttribute("aria-busy", "true");
  passInputs.forEach((input) => {
    input.disabled = true;
  });
  accessStatus.textContent = "正在验证…";

  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pass }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(errorCopy(payload.error));
    }

    state.accessPass = pass;
    state.authenticated = true;
    applyBotConfig(payload);
    accessScreen.hidden = true;
    chatScreen.hidden = false;
    questionInput.focus();
    await loadHistory();
  } catch (error) {
    showAccessError(error instanceof Error ? error.message : "口令验证失败，请稍后再试");
    passInputs.forEach((input) => {
      input.value = "";
    });
    passInputs[0].focus();
  } finally {
    state.authenticating = false;
    passcodeFields.removeAttribute("aria-busy");
    passInputs.forEach((input) => {
      input.disabled = false;
    });
  }
}

function clearAccessError() {
  accessStatus.textContent = "";
  passcodeFields.classList.remove("is-invalid");
  passInputs.forEach((input) => input.removeAttribute("aria-invalid"));
}

function showAccessError(message) {
  accessStatus.textContent = message;
  passcodeFields.classList.remove("is-invalid");
  passInputs.forEach((input) => input.setAttribute("aria-invalid", "true"));
  requestAnimationFrame(() => passcodeFields.classList.add("is-invalid"));
}

async function sendQuestion() {
  const text = questionInput.value.trim();

  if (!state.authenticated || !state.accessPass) {
    return;
  }

  if (!text) {
    questionInput.focus();
    return;
  }

  const tempId = `local-${crypto.randomUUID()}`;
  const now = Date.now();
  state.messages.set(tempId, {
    id: tempId,
    question: text,
    reply: null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    local: true,
  });
  state.pendingSince.set(tempId, now);
  questionInput.value = "";
  resizeComposer();
  setSending(true);
  setStatus(`${state.botName} 正在思考`);
  renderMessages(true);

  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, pass: state.accessPass }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(errorCopy(payload.error));
    }

    const message = state.messages.get(tempId);
    state.messages.delete(tempId);
    state.pendingSince.delete(tempId);
    const savedMessage = {
      ...message,
      id: payload.id,
      status: payload.status,
      local: false,
    };
    state.messages.set(payload.id, savedMessage);
    state.pendingSince.set(payload.id, now);
    promoteMessageElement(tempId, payload.id);
    setStatus(`${state.botName} 正在思考`);
    startPolling();
  } catch (error) {
    const failed = state.messages.get(tempId);
    if (failed) {
      state.messages.set(tempId, {
        ...failed,
        status: "failed",
        reply: "发送没有成功，请检查网络或稍后再试。",
        updatedAt: Date.now(),
      });
      state.pendingSince.delete(tempId);
    }
    setStatus(error instanceof Error ? error.message : "发送失败，请稍后再试。");
  } finally {
    setSending(false);
    renderMessages(true);
    questionInput.focus();
  }
}

async function loadHistory() {
  if (state.loadingHistory) {
    return;
  }

  if (!state.authenticated) {
    return;
  }

  state.loadingHistory = true;
  setStatus("正在读取聊天记录");

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
    setStatus(messages.length ? "聊天记录已加载" : "开始一段新对话");
    renderMessages(true);
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
  if (state.polling) {
    return;
  }

  if (!hasPending()) {
    stopPolling();
    return;
  }

  state.polling = true;
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
    renderMessages();
    state.polling = false;
    return;
  }

  try {
    const shouldStick = isNearBottom();
    const messages = await fetchMessages();
    for (const message of messages) {
      state.messages.set(message.id, message);
      if (message.status === "done") {
        state.pendingSince.delete(message.id);
      }
    }
    setStatus(hasPending() ? `${state.botName} 正在思考` : "回答已更新");
    renderMessages(shouldStick);
    if (!hasPending()) {
      stopPolling();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "刷新回答失败，稍后会再试。");
  } finally {
    state.polling = false;
  }
}

async function fetchMessages() {
  const params = new URLSearchParams({ pass: state.accessPass });

  const response = await fetch(`/api/messages?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(errorCopy(payload.error));
  }

  return payload.messages;
}

function renderMessages(forceToBottom = false) {
  const stickToBottom = forceToBottom || isNearBottom();
  const messages = [...state.messages.values()].sort((a, b) => a.createdAt - b.createdAt);
  const activeIds = new Set(messages.map((message) => message.id));

  for (const [id, element] of state.messageElements) {
    if (!activeIds.has(id)) {
      element.remove();
      state.messageElements.delete(id);
    }
  }

  emptyState.hidden = messages.length > 0;
  let nextElement = emptyState.nextElementSibling;
  for (const message of messages) {
    let element = state.messageElements.get(message.id);
    if (!element) {
      element = createMessageElement(message);
      state.messageElements.set(message.id, element);
    }
    updateMessageElement(element, message);
    if (element !== nextElement) {
      messageList.insertBefore(element, nextElement);
    }
    nextElement = element.nextElementSibling;
  }

  if (stickToBottom) {
    requestAnimationFrame(() => {
      messageList.scrollTop = messageList.scrollHeight;
    });
  }
}

function createMessageElement(message) {
  const thread = document.createElement("article");
  thread.className = "message-thread";
  thread.dataset.messageId = message.id;

  const userRow = document.createElement("div");
  userRow.className = "message-row user-row";
  const userBubble = document.createElement("div");
  userBubble.className = "user-bubble";
  userBubble.dataset.part = "question";
  userRow.append(userBubble);

  const assistantRow = document.createElement("div");
  assistantRow.className = "message-row assistant-row";
  const avatar = document.createElement("img");
  avatar.className = "bot-avatar assistant-avatar";
  avatar.alt = "";
  avatar.width = 32;
  avatar.height = 32;
  avatar.addEventListener("error", () => setAvatarSource(avatar, DEFAULT_BOT_AVATAR));
  setAvatarSource(avatar, state.botAvatarUrl);
  const assistantContent = document.createElement("div");
  assistantContent.className = "assistant-content";
  assistantContent.dataset.part = "reply";
  assistantRow.append(avatar, assistantContent);

  thread.append(userRow, assistantRow);
  return thread;
}

function updateMessageElement(element, message) {
  const question = element.querySelector('[data-part="question"]');
  const reply = element.querySelector('[data-part="reply"]');
  if (question.textContent !== message.question) {
    question.textContent = message.question;
  }

  if (message.reply) {
    reply.classList.remove("is-thinking");
    if (reply.textContent !== message.reply) {
      reply.textContent = message.reply;
    }
    return;
  }

  if (message.status === "pending") {
    if (!reply.classList.contains("is-thinking")) {
      reply.classList.add("is-thinking");
      reply.replaceChildren(...[0, 1, 2].map(() => {
        const dot = document.createElement("span");
        dot.className = "thinking-dot";
        return dot;
      }));
    }
  }
}

function promoteMessageElement(oldId, newId) {
  const element = state.messageElements.get(oldId);
  if (!element) {
    return;
  }

  state.messageElements.delete(oldId);
  state.messageElements.set(newId, element);
  element.dataset.messageId = newId;
}

function hasPending() {
  return [...state.messages.values()].some((message) => message.status === "pending");
}

function setSending(isSending) {
  state.sending = isSending;
  updateSendButton();
}

function updateSendButton() {
  sendButton.disabled = state.sending || !questionInput.value.trim();
}

function setStatus(message) {
  statusLine.textContent = message;
}

function isNearBottom() {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 96;
}

function resizeComposer() {
  questionInput.style.height = "auto";
  questionInput.style.height = `${Math.min(questionInput.scrollHeight, 144)}px`;
}

function errorCopy(code) {
  const copies = {
    access_pass_not_configured: "服务器还没有配置家庭口令，暂时不能读取或发送消息。",
    access_pass_invalid_configuration: "服务器口令配置有误，请联系分享者。",
    access_pass_required: "口令不正确，请再试一次",
    invalid_json: "请求格式不正确。",
    json_required: "请求需要 JSON 格式。",
    text_required: "请写下想问的问题。",
    text_too_long: "问题太长了，先精简一下再发送。",
    pass_too_long: "家庭口令太长了。",
    reply_secret_not_configured: "服务器还没有配置回复密钥。",
    server_error: "服务器刚刚开小差了，请稍后再试。",
  };

  return copies[code] || "操作没有成功，请稍后再试。";
}
