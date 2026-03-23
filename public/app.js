const localUrlStorageKey = "webhookrelay:local-url";

const state = {
  apps: [],
  query: "",
  selectedApp: null,
  session: null,
};

const appCount = document.querySelector("#app-count");
const appGrid = document.querySelector("#app-grid");
const searchInput = document.querySelector("#search-input");
const filterCopy = document.querySelector("#filter-copy");
const modal = document.querySelector("#app-modal");
const modalTitle = document.querySelector("#modal-title");
const modalCategory = document.querySelector("#modal-category");
const modalSubtitle = document.querySelector("#modal-subtitle");
const modalStatus = document.querySelector("#modal-status");
const localUrlInput = document.querySelector("#local-url-input");
const listenerScript = document.querySelector("#listener-script");
const hookUrl = document.querySelector("#hook-url");
const curlCommand = document.querySelector("#curl-command");
const copyScript = document.querySelector("#copy-script");
const copyHook = document.querySelector("#copy-hook");
const copyCurl = document.querySelector("#copy-curl");

function getInitialLocalUrl() {
  return window.localStorage.getItem(localUrlStorageKey) || "http://127.0.0.1:3000/webhook";
}

function setStatus(message, isError = false) {
  modalStatus.textContent = message;
  modalStatus.classList.toggle("error", isError);
}

function byQuery(app) {
  if (!state.query) {
    return true;
  }

  const haystack = `${app.name} ${app.category}`.toLowerCase();
  return haystack.includes(state.query);
}

function visibleApps() {
  return state.apps.filter(byQuery);
}

function buildCard(app) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  button.addEventListener("click", () => openModal(app));

  const top = document.createElement("div");
  top.className = "card-top";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = app.name.slice(0, 1).toUpperCase();

  const score = document.createElement("div");
  score.className = "score";
  score.textContent = `${app.popularity7d} / 7d`;

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = app.name;

  const category = document.createElement("div");
  category.className = "card-category";
  category.textContent = app.category;

  top.append(avatar, score);
  button.append(top, name, category);
  return button;
}

function renderGrid() {
  const items = visibleApps();
  appCount.textContent = `${state.apps.length} apps`;
  filterCopy.textContent = state.query
    ? `${items.length} apps match "${state.query}".`
    : `${items.length} apps sorted by rolling 7 day popularity.`;

  appGrid.replaceChildren(...items.map(buildCard));
}

function getErrorMessage(payload) {
  return payload?.error?.message || "Unable to create a relay session right now.";
}

function getNextStep(payload) {
  return payload?.error?.nextStep || "Retry once, then create a fresh relay session.";
}

function buildListenerScript(app, session, localUrl) {
  return [
    `const LOCAL_URL = ${JSON.stringify(localUrl)};`,
    `const RELAY_URL = ${JSON.stringify(session.wsUrl)};`,
    `const APP_NAME = ${JSON.stringify(app.name)};`,
    "",
    "function connect() {",
    "  const ws = new WebSocket(RELAY_URL);",
    "",
    '  ws.onopen = () => console.log("webhookrelay connected for " + APP_NAME + " -> " + LOCAL_URL);',
    "",
    "  ws.onmessage = async ({ data }) => {",
    "    const msg = JSON.parse(data);",
    '    if (msg.type !== "webhook") return;',
    "",
    "    const url = new URL(LOCAL_URL);",
    "    for (const [key, value] of new URLSearchParams(msg.search)) {",
    "      url.searchParams.append(key, value);",
    "    }",
    "",
    "    try {",
    "      const response = await fetch(url, {",
    "        method: msg.method,",
    "        headers: msg.headers,",
    '        body: msg.body ? Buffer.from(msg.body, "base64") : undefined,',
    "      });",
    "",
    "      const body = Buffer.from(await response.arrayBuffer());",
    "      const safeBody = body.length > 65536 ? body.subarray(0, 65536) : body;",
    "",
    "      ws.send(JSON.stringify({",
    '        type: "response",',
    "        id: msg.id,",
    "        status: response.status,",
    '        headers: { "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8" },',
    '        body: safeBody.toString("base64"),',
    "      }));",
    "    } catch (error) {",
    "      ws.send(JSON.stringify({",
    '        type: "response",',
    "        id: msg.id,",
    "        status: 502,",
    '        headers: { "content-type": "application/json; charset=utf-8" },',
    '        body: Buffer.from(JSON.stringify({',
    "          ok: false,",
    "          error: {",
    '            code: "local_fetch_failed",',
    '            message: String(error),',
    '            nextStep: "Make sure LOCAL_URL is running, then send the webhook again.",',
    "          },",
    '        })).toString("base64"),',
    "      }));",
    "    }",
    "  };",
    "",
    "  ws.onclose = () => {",
    '    console.log("webhookrelay disconnected. Reconnecting in 1s...");',
    "    setTimeout(connect, 1000);",
    "  };",
    "",
    '  ws.onerror = (error) => console.error("webhookrelay error", error);',
    "}",
    "",
    "connect();",
  ].join("\n");
}

function buildCurlCommand(app, session) {
  return [
    `curl -i ${JSON.stringify(session.hookUrl)} \\`,
    "  -X POST \\",
    "  -H 'content-type: application/json' \\",
    `  -d '${JSON.stringify({ source: app.name, hello: "webhookrelay", sentAt: new Date().toISOString() })}'`,
  ].join("\n");
}

function renderSession() {
  if (!state.selectedApp || !state.session) {
    return;
  }

  const localUrl = localUrlInput.value.trim() || getInitialLocalUrl();

  modalTitle.textContent = state.selectedApp.name;
  modalCategory.textContent = state.selectedApp.category;
  modalSubtitle.textContent = `${state.selectedApp.popularity7d} relay sessions started in the last 7 days.`;
  hookUrl.textContent = state.session.hookUrl;
  listenerScript.textContent = buildListenerScript(state.selectedApp, state.session, localUrl);
  curlCommand.textContent = buildCurlCommand(state.selectedApp, state.session);
  setStatus("Fresh relay ready. Run the listener, then send a test webhook.");
}

async function openModal(app) {
  state.selectedApp = app;
  state.session = null;
  modalTitle.textContent = app.name;
  modalCategory.textContent = app.category;
  modalSubtitle.textContent = "Generating a fresh relay session...";
  hookUrl.textContent = "";
  listenerScript.textContent = "";
  curlCommand.textContent = "";
  setStatus("Creating your relay session...");

  if (!modal.open) {
    modal.showModal();
  }

  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ appId: app.id }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw payload;
    }

    state.session = payload.session;
    renderSession();
  } catch (payload) {
    setStatus(`${getErrorMessage(payload)} ${getNextStep(payload)}`, true);
  }
}

async function copyText(text, fallbackLabel, button) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    const current = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = current;
    }, 1200);
  } catch {
    setStatus(`Copy failed. Select the ${fallbackLabel} manually and copy it.`, true);
  }
}

async function loadApps() {
  try {
    const response = await fetch("/api/apps");
    const payload = await response.json();

    if (!response.ok) {
      throw payload;
    }

    state.apps = payload.items;
    renderGrid();
  } catch (payload) {
    filterCopy.textContent = `${getErrorMessage(payload)} ${getNextStep(payload)}`;
    filterCopy.classList.add("error");
  }
}

searchInput.addEventListener("input", () => {
  state.query = searchInput.value.trim().toLowerCase();
  renderGrid();
});

localUrlInput.value = getInitialLocalUrl();
localUrlInput.addEventListener("input", () => {
  window.localStorage.setItem(localUrlStorageKey, localUrlInput.value.trim());

  if (state.session && state.selectedApp) {
    renderSession();
  }
});

copyScript.addEventListener("click", () => copyText(listenerScript.textContent, "listener script", copyScript));
copyHook.addEventListener("click", () => copyText(hookUrl.textContent, "webhook URL", copyHook));
copyCurl.addEventListener("click", () => copyText(curlCommand.textContent, "curl command", copyCurl));

loadApps();
