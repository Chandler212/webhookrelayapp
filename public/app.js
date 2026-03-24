const localUrlStorageKey = "webhookrelay:local-url";
const defaultLocalUrl = "http://localhost:3000/api/webhook";
const legacyDefaultLocalUrl = "http://127.0.0.1:3000/webhook";
const cliAssetPath = "/cli/webhookrelay.mjs";
const cliGithubSourceUrl = "https://github.com/Chandler212/webhookrelayapp/blob/main/public/cli/webhookrelay.mjs";
const listenerStatusPollMs = 1000;
const listenerFlashMs = 1600;
const hookCopyAdvanceMs = 3000;

/** Must match `CUSTOM_APP_ID` in `src/catalog/apps.ts`. */
const CUSTOM_APP_ID = "custom";

let listenerPollTimer = 0;
let listenerPollBusy = false;
let hookCopyTimer = 0;
let stepFocusTimer = 0;

const state = {
  apps: [],
  query: "",
  selectedApp: null,
  session: null,
  showComments: false,
  listenerStatus: null,
  listenerFlashUntil: 0,
  terminalBCopied: false,
  hookCopyPending: false,
  hookStepComplete: false,
  localUrlConfirmed: false,
  currentStep: 0,
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
const confirmLocalUrl = document.querySelector("#confirm-local-url");
const listenerScript = document.querySelector("#listener-script");
const listenerLive = document.querySelector("#listener-live");
const listenerLiveLabel = document.querySelector("#listener-live-label");
const listenerLiveMeta = document.querySelector("#listener-live-meta");
const hookUrl = document.querySelector("#hook-url");
const curlCommand = document.querySelector("#curl-command");
const cliCommand = document.querySelector("#cli-command");
const copyScript = document.querySelector("#copy-script");
const copyHook = document.querySelector("#copy-hook");
const copyCurl = document.querySelector("#copy-curl");
const copyCli = document.querySelector("#copy-cli");
const hookSection = document.querySelector("#hook-section");
const localUrlSection = document.querySelector("#local-url-section");
const terminalASection = document.querySelector("#terminal-a-section");
const terminalBSection = document.querySelector("#terminal-b-section");
const downloadCli = document.querySelector("#download-cli");
const viewCliSource = document.querySelector("#view-cli-source");
const toggleComments = document.querySelector("#toggle-comments");
const modalPipeline = document.querySelector("#modal-pipeline");
const pipeSource = document.querySelector("#pipe-source");
const pipeRelay = document.querySelector("#pipe-relay");
const pipeTerminal = document.querySelector("#pipe-terminal");
const pipeLocal = document.querySelector("#pipe-local");
const pipeEdgeIngress = document.querySelector("#pipe-edge-ingress");
const pipeEdgeWs = document.querySelector("#pipe-edge-ws");
const pipeEdgeForward = document.querySelector("#pipe-edge-forward");
const pipeEdgeLocal = document.querySelector("#pipe-edge-local");
const modalStep1 = document.querySelector("#modal-step-1");
const modalStep2 = document.querySelector("#modal-step-2");
const modalStep3 = document.querySelector("#modal-step-3");
const modalStep4 = document.querySelector("#modal-step-4");
const modalStep1Number = document.querySelector("#modal-step-1-number");
const modalStep2Number = document.querySelector("#modal-step-2-number");
const modalStep3Number = document.querySelector("#modal-step-3-number");
const modalStep4Number = document.querySelector("#modal-step-4-number");
const modalStep1Copy = document.querySelector("#modal-step-1-copy");
const modalStep2Copy = document.querySelector("#modal-step-2-copy");
const modalStep3Copy = document.querySelector("#modal-step-3-copy");
const modalStep4Copy = document.querySelector("#modal-step-4-copy");

const stepSections = new Map([
  [1, hookSection],
  [2, localUrlSection],
  [3, terminalASection],
  [4, terminalBSection],
]);

const stepTargets = new Map([
  [1, copyHook],
  [2, localUrlInput],
  [3, copyScript],
  [4, copyCurl],
]);

const stepButtons = new Map([
  [1, modalStep1],
  [2, modalStep2],
  [3, modalStep3],
  [4, modalStep4],
]);

const stepNumberEls = new Map([
  [1, modalStep1Number],
  [2, modalStep2Number],
  [3, modalStep3Number],
  [4, modalStep4Number],
]);

const stepCopyEls = new Map([
  [1, modalStep1Copy],
  [2, modalStep2Copy],
  [3, modalStep3Copy],
  [4, modalStep4Copy],
]);

function emptyListenerStatus() {
  return {
    connected: false,
    inFlightCount: 0,
    lastActivityAt: null,
    ingressAt: null,
    ingressSmokeAt: null,
    ingressLiveAt: null,
    forwardedAt: null,
    listenerReplyAt: null,
  };
}

function formatRelayNode(hookUrl) {
  try {
    const u = new URL(hookUrl);
    const segments = u.pathname.split("/").filter(Boolean);
    const hookId = segments.length >= 2 ? decodeURIComponent(segments[1]) : decodeURIComponent(segments[0] || "");
    const tail = hookId.length > 6 ? `…${hookId.slice(-6)}` : hookId;
    return `${u.host}/h/${tail}`;
  } catch {
    return hookUrl;
  }
}

function formatLocalNode(localUrl) {
  try {
    const u = new URL(localUrl);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return `${u.hostname}:${port}`;
  } catch {
    return "localhost";
  }
}

function getCurrentLocalUrl() {
  return localUrlInput.value.trim() || getInitialLocalUrl();
}

function clearHookCopyTimer() {
  if (hookCopyTimer) {
    window.clearTimeout(hookCopyTimer);
    hookCopyTimer = 0;
  }

  state.hookCopyPending = false;
}

function clearStepFocusTimer() {
  if (stepFocusTimer) {
    window.clearTimeout(stepFocusTimer);
    stepFocusTimer = 0;
  }
}

function scrollStepSectionIntoView(section, behavior = "smooth") {
  if (!modal.open) {
    return;
  }

  let alignToY;
  if (modalPipeline && !modalPipeline.hidden) {
    const pipeRect = modalPipeline.getBoundingClientRect();
    alignToY = pipeRect.bottom + 10;
  } else {
    const modalRect = modal.getBoundingClientRect();
    alignToY = modalRect.top + 16;
  }

  const sectionRect = section.getBoundingClientRect();
  const delta = sectionRect.top - alignToY;
  if (Math.abs(delta) < 3) {
    return;
  }

  modal.scrollBy({
    top: delta,
    behavior: behavior === "smooth" ? "smooth" : "auto",
  });
}

function focusStep(step, behavior = "smooth") {
  const section = stepSections.get(step);
  const target = stepTargets.get(step);

  if (!section || !modal.open) {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollStepSectionIntoView(section, behavior);
    });
  });

  if (!target || typeof target.focus !== "function") {
    return;
  }

  clearStepFocusTimer();
  stepFocusTimer = window.setTimeout(() => {
    if (!modal.open) {
      return;
    }

    target.focus({ preventScroll: true });
  }, behavior === "smooth" ? 180 : 0);
}

function tryParseLocalUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function normalizeSessionStatusPayload(payload) {
  if (!payload || payload.ok !== true) {
    return emptyListenerStatus();
  }

  return {
    connected: Boolean(payload.connected),
    inFlightCount: Number(payload.inFlightCount) || 0,
    lastActivityAt: payload.lastActivityAt ?? null,
    ingressAt: payload.ingressAt ?? null,
    ingressSmokeAt: payload.ingressSmokeAt ?? null,
    ingressLiveAt: payload.ingressLiveAt ?? null,
    forwardedAt: payload.forwardedAt ?? null,
    listenerReplyAt: payload.listenerReplyAt ?? null,
  };
}

function didMilestoneAdvance(prev, next) {
  if (!prev || !next) {
    return false;
  }

  const keys = ["ingressAt", "ingressSmokeAt", "ingressLiveAt", "forwardedAt", "listenerReplyAt"];

  for (const key of keys) {
    const n = next[key];
    const p = prev[key];

    if (n != null && n !== p) {
      return true;
    }
  }

  if (next.connected && !prev.connected) {
    return true;
  }

  return false;
}

function setPipeEdgeDone(element, done) {
  element.dataset.done = done ? "true" : "false";
}

function isCustomApp(app) {
  return Boolean(app && app.id === CUSTOM_APP_ID);
}

/** Third-party name for paste-into copy; generic label for the custom relay card. */
function integrationLabel(app) {
  if (!app) {
    return "your app";
  }

  return isCustomApp(app) ? "your app" : app.name;
}

function listenerLogLabel(app) {
  if (!app) {
    return "Source";
  }

  return isCustomApp(app) ? "your app" : app.name;
}

function smokeTestSourceLabel(app) {
  return isCustomApp(app) ? "Custom integration" : app.name;
}

function catalogAppsList() {
  return state.apps.filter((app) => !app.hiddenFromGrid);
}

function stepStateFor(step, completed, currentStep) {
  if (completed[step]) {
    return "completed";
  }

  if (currentStep === step) {
    return "current";
  }

  return "upcoming";
}

function getStepProgress() {
  if (!state.session) {
    return null;
  }

  const appName = integrationLabel(state.selectedApp);
  const localUrl = getCurrentLocalUrl();
  const localNode = formatLocalNode(localUrl);
  const connected = Boolean(state.listenerStatus?.connected);
  const smokeSeen = Boolean(state.listenerStatus?.ingressSmokeAt);
  const step1Done = state.hookStepComplete;
  const step2Done = step1Done && state.localUrlConfirmed;
  const step3Done = step2Done && connected;
  const step4Done = step3Done && smokeSeen;
  let currentStep = 1;

  if (step4Done) {
    currentStep = 0;
  } else if (step3Done) {
    currentStep = 4;
  } else if (step2Done) {
    currentStep = 3;
  } else if (step1Done) {
    currentStep = 2;
  }

  const completed = {
    1: step1Done,
    2: step2Done,
    3: step3Done,
    4: step4Done,
  };

  return {
    currentStep,
    items: {
      1: {
        state: stepStateFor(1, completed, currentStep),
        copy: step1Done
          ? `Pasted into ${appName}.`
          : state.hookCopyPending
            ? `Copied. Paste it into ${appName}; moving on in 3s.`
            : `Copy the webhook URL into ${appName}.`,
      },
      2: {
        state: stepStateFor(2, completed, currentStep),
        copy: step2Done
          ? `Confirmed ${localNode} and your route.`
          : state.localUrlConfirmed
            ? `Confirmed ${localNode}. Finish step 1 next.`
            : currentStep === 2
              ? `Confirm ${localNode} and the path first.`
              : "Check your local port and path.",
      },
      3: {
        state: stepStateFor(3, completed, currentStep),
        copy: step3Done
          ? "Connection detected in Terminal A."
          : connected
            ? "Connected already. Finish the earlier steps."
            : currentStep === 3
              ? "Paste the listener command, then wait for the connection."
              : "Available after step 2.",
      },
      4: {
        state: stepStateFor(4, completed, currentStep),
        copy: step4Done
          ? "Smoke test received."
          : smokeSeen
            ? "Smoke test seen. Finish the earlier steps."
            : currentStep === 4 && state.terminalBCopied
              ? "Copied. Run it in another terminal now."
              : currentStep === 4
                ? "Run the smoke test curl in Terminal B."
                : "Available after Terminal A connects.",
      },
    },
  };
}

function handleStepTransition(previousStep, nextStep) {
  if (!modal.open || previousStep === nextStep) {
    return;
  }

  // First paint after session creation goes 0 → 1; skip scrolling so the view
  // stays on modal-header (category, title, subtitle) instead of jumping to step 1.
  if (previousStep === 0) {
    return;
  }

  if (nextStep === 0) {
    setStatus("Smoke test received. Your relay is active end to end.");
    return;
  }

  if (nextStep === 2) {
    setStatus("Webhook URL marked done. Confirm your local URL next.");
  } else if (nextStep === 3) {
    setStatus("Local URL confirmed. Run the Terminal A listener command next.");
  } else if (nextStep === 4) {
    setStatus("Connection detected. Run the smoke test curl in Terminal B.");
  }

  focusStep(nextStep);
}

function renderSetupProgress() {
  const progress = getStepProgress();

  if (!progress) {
    if (modalPipeline) {
      modalPipeline.hidden = true;
    }

    for (const step of [1, 2, 3, 4]) {
      const fallbackState = step === 1 ? "current" : "upcoming";
      const button = stepButtons.get(step);
      const number = stepNumberEls.get(step);
      const section = stepSections.get(step);

      if (button) {
        button.dataset.stepState = fallbackState;
        button.removeAttribute("aria-current");
      }

      if (number) {
        number.textContent = String(step);
      }

      if (section) {
        section.dataset.stepState = fallbackState;
      }
    }

    state.currentStep = 0;
    return;
  }

  if (modalPipeline) {
    modalPipeline.hidden = false;
  }

  for (const step of [1, 2, 3, 4]) {
    const item = progress.items[step];
    const button = stepButtons.get(step);
    const number = stepNumberEls.get(step);
    const copy = stepCopyEls.get(step);
    const section = stepSections.get(step);

    if (button) {
      button.dataset.stepState = item.state;

      if (item.state === "current") {
        button.setAttribute("aria-current", "step");
      } else {
        button.removeAttribute("aria-current");
      }
    }

    if (number) {
      number.textContent = item.state === "completed" ? "✓" : String(step);
    }

    if (copy) {
      copy.textContent = item.copy;
    }

    if (section) {
      section.dataset.stepState = item.state;
    }
  }

  const previousStep = state.currentStep;
  state.currentStep = progress.currentStep;
  handleStepTransition(previousStep, progress.currentStep);
}

function queueHookStepCompletion() {
  if (!state.session || state.hookStepComplete) {
    return;
  }

  const sessionHookId = state.session.hookId;
  clearHookCopyTimer();
  state.hookCopyPending = true;
  renderSetupProgress();
  setStatus(`Webhook URL copied. Paste it into ${integrationLabel(state.selectedApp)}. Step 2 will unlock in 3 seconds.`);

  hookCopyTimer = window.setTimeout(() => {
    if (!state.session || state.session.hookId !== sessionHookId) {
      return;
    }

    hookCopyTimer = 0;
    state.hookCopyPending = false;
    state.hookStepComplete = true;
    renderSetupProgress();
  }, hookCopyAdvanceMs);
}

function renderPipeline() {
  if (!modalPipeline) {
    return;
  }

  if (!state.session) {
    modalPipeline.hidden = true;
    return;
  }

  modalPipeline.hidden = false;

  const status = state.listenerStatus ?? emptyListenerStatus();
  const localUrl = getCurrentLocalUrl();
  const appName = listenerLogLabel(state.selectedApp);
  const smokeSeen = Boolean(status.ingressSmokeAt);
  const liveSeen = Boolean(status.ingressLiveAt);
  const showTerminalBSource =
    (smokeSeen && !liveSeen) || state.terminalBCopied;
  pipeSource.textContent = showTerminalBSource ? `${appName} (Terminal B)` : appName;

  pipeRelay.textContent = formatRelayNode(state.session.hookUrl);
  pipeRelay.dataset.session = "true";

  pipeTerminal.textContent = "Terminal A";
  pipeLocal.textContent = formatLocalNode(localUrl);

  setPipeEdgeDone(pipeEdgeIngress, Boolean(status.ingressAt));
  setPipeEdgeDone(pipeEdgeWs, Boolean(status.connected));
  setPipeEdgeDone(pipeEdgeForward, Boolean(status.forwardedAt));
  setPipeEdgeDone(pipeEdgeLocal, Boolean(status.listenerReplyAt));
}

function getInitialLocalUrl() {
  const stored = window.localStorage.getItem(localUrlStorageKey)?.trim();

  if (!stored || stored === legacyDefaultLocalUrl) {
    return defaultLocalUrl;
  }

  return stored;
}

function getCliDownloadUrl() {
  return new URL(cliAssetPath, window.location.origin).toString();
}

function setStatus(message, isError = false) {
  modalStatus.textContent = message;
  modalStatus.classList.toggle("error", isError);
}

function setListenerLiveState(kind, label, meta) {
  listenerLive.dataset.state = kind;
  listenerLiveLabel.textContent = label;
  listenerLiveMeta.textContent = meta;
}

function renderListenerState() {
  let kind = "waiting";
  let label = "Waiting for Terminal A";
  let meta = "Run the listener command in Terminal A to start listening.";

  if (!state.session) {
    setListenerLiveState(kind, label, meta);
    renderPipeline();
    renderSetupProgress();
    return;
  }

  const connected = Boolean(state.listenerStatus?.connected);
  const inFlightCount = state.listenerStatus?.inFlightCount ?? 0;
  const recentlyActive = Date.now() < state.listenerFlashUntil;

  if (connected && (inFlightCount > 0 || recentlyActive)) {
    kind = "active";
    label = "Webhook passing through";
    meta = "Stop listening with Ctrl+C in Terminal A.";
  } else if (connected) {
    kind = "listening";
    label = "Listening";
    meta = "Stop listening with Ctrl+C in Terminal A.";
  }

  setListenerLiveState(kind, label, meta);
  renderPipeline();
  renderSetupProgress();
}

function byQuery(app) {
  if (!state.query) {
    return true;
  }

  const haystack = `${app.name} ${app.category}`.toLowerCase();
  return haystack.includes(state.query);
}

function visibleApps() {
  const listed = catalogAppsList();

  if (!state.query) {
    return listed;
  }

  const matched = listed.filter(byQuery);

  if (matched.length > 0) {
    return matched;
  }

  const custom = state.apps.find((app) => app.id === CUSTOM_APP_ID);
  return custom ? [custom] : [];
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
  const listedTotal = catalogAppsList().length;
  appCount.textContent = `${listedTotal} apps`;
  if (!state.query) {
    filterCopy.textContent = `${listedTotal} apps sorted by rolling 7 day popularity.`;
  } else if (items.length === 1 && isCustomApp(items[0])) {
    filterCopy.textContent = `No catalog match for "${state.query}". Create App relays webhooks to your own integration.`;
  } else {
    filterCopy.textContent = `${items.length} apps match "${state.query}".`;
  }

  appGrid.replaceChildren(...items.map(buildCard));
}

function getErrorMessage(payload) {
  return payload?.error?.message || "Unable to create a relay session right now.";
}

function getNextStep(payload) {
  return payload?.error?.nextStep || "Retry once, then create a fresh relay session.";
}

function buildListenerCommand(app, session, localUrl, showComments) {
  const lines = [];

  if (showComments) {
    lines.push("# Run this whole block in Terminal A.");
  }

  lines.push("node <<'EOF'");

  if (showComments) {
    lines.push("// Your local webhook handler.");
  }

  lines.push(`const LOCAL_URL = ${JSON.stringify(localUrl)};`);

  if (showComments) {
    lines.push("// The live relay socket for this fresh session.");
  }

  lines.push(`const RELAY_URL = ${JSON.stringify(session.wsUrl)};`);
  lines.push(`const APP_NAME = ${JSON.stringify(listenerLogLabel(app))};`);
  lines.push("");
  lines.push('const RESET = "\\x1b[0m";');
  lines.push('const DIM = "\\x1b[2m";');
  lines.push('const CYAN = "\\x1b[36m";');
  lines.push('const GREEN = "\\x1b[32m";');
  lines.push('const YELLOW = "\\x1b[33m";');
  lines.push('const RED = "\\x1b[31m";');
  lines.push("let activeSocket = null;");
  lines.push("let shouldReconnect = true;");
  lines.push("");
  lines.push("function tag(label, color) {");
  lines.push('  return color + "[" + label + "]" + RESET;');
  lines.push("}");
  lines.push("");
  lines.push("function now() {");
  lines.push("  return new Date().toLocaleTimeString();");
  lines.push("}");
  lines.push("");
  lines.push("function headerLookup(headers, name) {");
  lines.push("  if (!headers) return null;");
  lines.push("  const lower = name.toLowerCase();");
  lines.push("  for (const key of Object.keys(headers)) {");
  lines.push("    if (key.toLowerCase() === lower) return headers[key];");
  lines.push("  }");
  lines.push("  return null;");
  lines.push("}");
  lines.push("");
  lines.push("function stripSmokeHeaders(headers) {");
  lines.push("  const next = { ...(headers || {}) };");
  lines.push("  for (const key of Object.keys(next)) {");
  lines.push('    if (key.toLowerCase() === "x-webhookrelay-smoke") delete next[key];');
  lines.push("  }");
  lines.push("  return next;");
  lines.push("}");
  lines.push("");
  lines.push("function localListenPort(localUrl) {");
  lines.push("  const u = new URL(localUrl);");
  lines.push('  return u.port || (u.protocol === "https:" ? "443" : "80");');
  lines.push("}");
  lines.push("");
  lines.push("function listenCheckSteps(port) {");
  lines.push("  return [");
  lines.push('    "Only port " + port + ": lsof -nP -iTCP:" + port + " -sTCP:LISTEN",');
  lines.push('    "Every TCP listener: lsof -nP -iTCP -sTCP:LISTEN",');
  lines.push("  ];");
  lines.push("}");
  lines.push("");
  lines.push("function encodeSmokeBody(payload) {");
  lines.push('  return Buffer.from(JSON.stringify(payload, null, 2) + "\\n").toString("base64");');
  lines.push("}");
  lines.push("");

  if (showComments) {
    lines.push("// Keep one websocket open and reconnect if it drops.");
  }

  lines.push("function connect() {");
  lines.push("  const ws = new WebSocket(RELAY_URL);");
  lines.push("  activeSocket = ws;");
  lines.push("");
  lines.push("  ws.onopen = () => {");
  lines.push('    console.log(tag("listen", CYAN), now(), "webhookrelay listening for", APP_NAME, "->", LOCAL_URL);');
  lines.push("  };");
  lines.push("");
  lines.push("  ws.onmessage = async ({ data }) => {");
  lines.push("    const msg = JSON.parse(data);");
  lines.push('    if (msg.type !== "webhook") return;');
  lines.push("");
  lines.push("    const startedAt = Date.now();");
  lines.push('    console.log(tag("hit", YELLOW), now(), msg.method, msg.appName || APP_NAME, msg.search || "");');
  lines.push("");

  if (showComments) {
    lines.push("    // Replay the incoming webhook to your local app.");
  }

  lines.push("    const url = new URL(LOCAL_URL);");
  lines.push("    for (const [key, value] of new URLSearchParams(msg.search)) {");
  lines.push("      url.searchParams.append(key, value);");
  lines.push("    }");
  lines.push("");
  lines.push("    const isSmoke = headerLookup(msg.headers, \"x-webhookrelay-smoke\") === \"1\";");
  lines.push("    const forwardHeaders = stripSmokeHeaders(msg.headers);");
  lines.push("    const listenPort = localListenPort(LOCAL_URL);");
  lines.push("    const localPath = new URL(LOCAL_URL).pathname;");
  lines.push("");
  lines.push("    try {");
  lines.push("      const response = await fetch(url, {");
  lines.push("        method: msg.method,");
  lines.push("        headers: forwardHeaders,");
  lines.push('        body: msg.body ? Buffer.from(msg.body, "base64") : undefined,');
  lines.push("      });");
  lines.push("");
  lines.push("      const body = Buffer.from(await response.arrayBuffer());");
  lines.push("      const safeBody = body.length > 65536 ? body.subarray(0, 65536) : body;");
  lines.push("");

  if (showComments) {
    lines.push("      // Send your local app's response back through webhookrelay.");
  }

  lines.push("      if (isSmoke) {");
  lines.push("        let smokePayload;");
  lines.push("        if (response.ok) {");
  lines.push("          smokePayload = {");
  lines.push("            ok: true,");
  lines.push("            smokeTest: true,");
  lines.push('            code: "local_ok",');
  lines.push("            port: listenPort,");
  lines.push(
    '            summary: "Success, your localhost application received the message on port " + listenPort + ".",',
  );
  lines.push("            localStatus: response.status,");
  lines.push("          };");
  lines.push("        } else if (response.status === 404) {");
  lines.push("          smokePayload = {");
  lines.push("            ok: false,");
  lines.push("            smokeTest: true,");
  lines.push('            code: "local_not_found",');
  lines.push("            port: listenPort,");
  lines.push("            path: localPath,");
  lines.push(
    '            summary: "Webhookrelay received your smoke test and reached your machine on port " + listenPort + ", but your app responded with HTTP 404 (no handler for this path).",',
  );
  lines.push(
    '            nextSteps: listenCheckSteps(listenPort).concat(["Then fix your Local URL or add a matching route."]),',
  );
  lines.push("          };");
  lines.push("        } else {");
  lines.push("          smokePayload = {");
  lines.push("            ok: false,");
  lines.push("            smokeTest: true,");
  lines.push('            code: "local_error",');
  lines.push("            port: listenPort,");
  lines.push("            localStatus: response.status,");
  lines.push(
    '            summary: "Webhookrelay reached port " + listenPort + ", but your app returned HTTP " + response.status + ".",',
  );
  lines.push("            nextSteps: listenCheckSteps(listenPort),");
  lines.push("          };");
  lines.push("        }");
  lines.push("        ws.send(JSON.stringify({");
  lines.push('          type: "response",');
  lines.push("          id: msg.id,");
  lines.push("          status: 200,");
  lines.push('          headers: { "content-type": "application/json; charset=utf-8" },');
  lines.push('          body: encodeSmokeBody(smokePayload),');
  lines.push("        }));");
  lines.push(
    '        console.log(tag("done", GREEN), now(), "smoke", response.status, "->", 200, msg.method, "in", Date.now() - startedAt + "ms");',
  );
  lines.push("      } else {");
  lines.push("        ws.send(JSON.stringify({");
  lines.push('          type: "response",');
  lines.push("          id: msg.id,");
  lines.push("          status: response.status,");
  lines.push('          headers: { "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8" },');
  lines.push('          body: safeBody.toString("base64"),');
  lines.push("        }));");
  lines.push(
    '        console.log(tag("done", GREEN), now(), response.status, msg.method, "in", Date.now() - startedAt + "ms");',
  );
  lines.push("      }");
  lines.push("    } catch (error) {");

  if (showComments) {
    lines.push("      // If LOCAL_URL is down, return a clear error upstream.");
  }

  lines.push("      if (isSmoke) {");
  lines.push("        const smokePayload = {");
  lines.push("          ok: false,");
  lines.push("          smokeTest: true,");
  lines.push('          code: "local_unreachable",');
  lines.push("          port: listenPort,");
  lines.push(
    '          summary: "Webhookrelay received your smoke test, but nothing accepted the connection on port " + listenPort + " (your app may be stopped or on a different port).",',
  );
  lines.push("          nextSteps: listenCheckSteps(listenPort),");
  lines.push("          detail: String(error),");
  lines.push("        };");
  lines.push("        ws.send(JSON.stringify({");
  lines.push('          type: "response",');
  lines.push("          id: msg.id,");
  lines.push("          status: 200,");
  lines.push('          headers: { "content-type": "application/json; charset=utf-8" },');
  lines.push('          body: encodeSmokeBody(smokePayload),');
  lines.push("        }));");
  lines.push("      } else {");
  lines.push("        ws.send(JSON.stringify({");
  lines.push('          type: "response",');
  lines.push("          id: msg.id,");
  lines.push("          status: 502,");
  lines.push('          headers: { "content-type": "application/json; charset=utf-8" },');
  lines.push('          body: Buffer.from(JSON.stringify({');
  lines.push("            ok: false,");
  lines.push("            error: {");
  lines.push('              code: "local_fetch_failed",');
  lines.push('              message: String(error),');
  lines.push('              nextStep: "Make sure LOCAL_URL is running, then send the webhook again.",');
  lines.push("            },");
  lines.push('          })).toString("base64"),');
  lines.push("        }));");
  lines.push("      }");
  lines.push("");
  lines.push('      console.error(tag("error", RED), now(), "local fetch failed", String(error));');
  lines.push("    }");
  lines.push("  };");
  lines.push("");
  lines.push("  ws.onclose = () => {");
  lines.push("    if (activeSocket === ws) activeSocket = null;");
  lines.push("    if (!shouldReconnect) return;");
  lines.push('    console.log(DIM + "webhookrelay disconnected. Reconnecting in 1s..." + RESET);');
  lines.push("    setTimeout(connect, 1000);");
  lines.push("  };");
  lines.push("");
  lines.push('  ws.onerror = () => console.error(tag("error", RED), now(), "webhookrelay socket error");');
  lines.push("}");
  lines.push("");
  lines.push('process.on("SIGINT", () => {');
  lines.push("  shouldReconnect = false;");
  lines.push('  console.log(DIM + "Stopping webhookrelay listener..." + RESET);');
  lines.push("  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {");
  lines.push('    activeSocket.close(1000, "Stopped locally.");');
  lines.push("  }");
  lines.push("  setTimeout(() => process.exit(0), 50);");
  lines.push("});");
  lines.push("");
  lines.push("connect();");
  lines.push("EOF");

  return lines.join("\n");
}

function buildCliCommand(app, session, localUrl) {
  const downloadUrl = getCliDownloadUrl();
  return [
    "# Download the thin CLI from this site (no npm install).",
    `curl -fsSL ${JSON.stringify(downloadUrl)} -o "./webhookrelay.mjs"`,
    "",
    "# Session values (one per line for easy scanning).",
    `export RELAY_URL=${JSON.stringify(session.wsUrl)}`,
    `export LOCAL_URL=${JSON.stringify(localUrl)}`,
    `export APP_NAME=${JSON.stringify(listenerLogLabel(app))}`,
    "",
    'node "./webhookrelay.mjs"',
  ].join("\n");
}

function renderCommandMode() {
  toggleComments.textContent = state.showComments ? "Hide comments" : "Show comments";
  toggleComments.setAttribute("aria-pressed", String(state.showComments));
}

function buildCurlCommand(app, session) {
  const payload = JSON.stringify({
    source: smokeTestSourceLabel(app),
    hello: "webhookrelay",
    sentAt: new Date().toISOString(),
  });
  return [
    `curl -i ${JSON.stringify(session.hookUrl)} \\`,
    "  -X POST \\",
    "  -H 'content-type: application/json' \\",
    "  -H 'X-Webhookrelay-Smoke: 1' \\",
    "  --data-binary @- <<'WEBHOOKRELAY_JSON'",
    payload,
    "WEBHOOKRELAY_JSON",
  ].join("\n");
}

function stopListenerStatusPolling() {
  if (listenerPollTimer) {
    window.clearInterval(listenerPollTimer);
    listenerPollTimer = 0;
  }

  listenerPollBusy = false;
  state.listenerStatus = null;
  state.listenerFlashUntil = 0;
  renderListenerState();
}

async function loadListenerStatus() {
  if (!modal.open || !state.session || listenerPollBusy) {
    return;
  }

  listenerPollBusy = true;
  const hookId = state.session.hookId;
  const token = state.session.wsToken;
  const previousActivity = state.listenerStatus?.lastActivityAt ?? 0;

  try {
    const url = new URL("/api/session-status", window.location.origin);
    url.searchParams.set("hookId", hookId);

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const payload = await response.json().catch(() => null);

    if (!modal.open || state.session?.hookId !== hookId) {
      return;
    }

    if (!response.ok) {
      state.listenerStatus = emptyListenerStatus();
      renderListenerState();
      return;
    }

    const previousNormalized = state.listenerStatus ?? emptyListenerStatus();
    const normalized = normalizeSessionStatusPayload(payload);
    const nextActivity = normalized.lastActivityAt ?? 0;

    if (nextActivity && nextActivity !== previousActivity) {
      state.listenerFlashUntil = Date.now() + listenerFlashMs;
    }

    if (didMilestoneAdvance(previousNormalized, normalized) && modalPipeline) {
      modalPipeline.classList.remove("is-flash");
      void modalPipeline.offsetWidth;
      modalPipeline.classList.add("is-flash");
      window.setTimeout(() => {
        modalPipeline.classList.remove("is-flash");
      }, 900);
    }

    state.listenerStatus = normalized;
    renderListenerState();
  } catch {
    if (state.session?.hookId === hookId) {
      state.listenerStatus = emptyListenerStatus();
      renderListenerState();
    }
  } finally {
    listenerPollBusy = false;
  }
}

function startListenerStatusPolling() {
  stopListenerStatusPolling();

  if (!state.session) {
    return;
  }

  state.listenerStatus = emptyListenerStatus();
  renderListenerState();
  void loadListenerStatus();
  listenerPollTimer = window.setInterval(() => {
    void loadListenerStatus();
  }, listenerStatusPollMs);
}

function renderSession({ preserveStatus = false } = {}) {
  if (!state.selectedApp || !state.session) {
    return;
  }

  const localUrl = getCurrentLocalUrl();

  modalTitle.textContent = state.selectedApp.name;
  modalCategory.textContent = state.selectedApp.category;
  modalSubtitle.textContent = `Copy the webhook URL into ${integrationLabel(state.selectedApp)}, confirm your local URL, then connect Terminal A and run the smoke test.`;
  hookUrl.textContent = state.session.hookUrl;
  listenerScript.textContent = buildListenerCommand(state.selectedApp, state.session, localUrl, state.showComments);
  curlCommand.textContent = buildCurlCommand(state.selectedApp, state.session);
  cliCommand.textContent = buildCliCommand(state.selectedApp, state.session, localUrl);
  downloadCli.setAttribute("href", getCliDownloadUrl());
  viewCliSource.setAttribute("href", cliGithubSourceUrl);
  renderCommandMode();
  renderListenerState();

  if (!preserveStatus) {
    setStatus(`Step 1 of 4. Copy the webhook URL into ${integrationLabel(state.selectedApp)}.`);
  }
}

async function openModal(app) {
  stopListenerStatusPolling();
  clearHookCopyTimer();
  clearStepFocusTimer();
  state.selectedApp = app;
  state.session = null;
  state.showComments = false;
  state.terminalBCopied = false;
  state.hookStepComplete = false;
  state.localUrlConfirmed = false;
  state.currentStep = 0;
  modalTitle.textContent = app.name;
  modalCategory.textContent = app.category;
  modalSubtitle.textContent = "Generating a fresh relay session...";
  hookUrl.textContent = "";
  listenerScript.textContent = "";
  curlCommand.textContent = "";
  cliCommand.textContent = "";
  downloadCli.setAttribute("href", getCliDownloadUrl());
  viewCliSource.setAttribute("href", cliGithubSourceUrl);
  renderCommandMode();
  renderListenerState();
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
    startListenerStatusPolling();
  } catch (payload) {
    setStatus(`${getErrorMessage(payload)} ${getNextStep(payload)}`, true);
  }
}

async function copyText(text, fallbackLabel, button, onCopied) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    const iconCopy = button.classList.contains("code-blob-copy");
    if (iconCopy) {
      const prevAria = button.getAttribute("aria-label");
      button.setAttribute("aria-label", "Copied");
      window.setTimeout(() => {
        if (prevAria) {
          button.setAttribute("aria-label", prevAria);
        }
      }, 1200);
    } else {
      const current = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = current;
      }, 1200);
    }
    onCopied?.();
  } catch {
    setStatus(`Copy failed. Select the ${fallbackLabel} manually and copy it.`, true);
  }
}

function flashPipeSourceAfterHookCopy() {
  if (!modalPipeline || !pipeSource || modalPipeline.hidden) {
    return;
  }

  modalPipeline.classList.remove("is-source-copy-flash");
  void pipeSource.offsetWidth;
  modalPipeline.classList.add("is-source-copy-flash");
  window.setTimeout(() => {
    modalPipeline.classList.remove("is-source-copy-flash");
  }, 1000);
}

function flashPipeTerminalAfterTerminalACopy() {
  if (!modalPipeline || !pipeTerminal || modalPipeline.hidden) {
    return;
  }

  modalPipeline.classList.remove("is-terminal-copy-flash");
  void pipeTerminal.offsetWidth;
  modalPipeline.classList.add("is-terminal-copy-flash");
  window.setTimeout(() => {
    modalPipeline.classList.remove("is-terminal-copy-flash");
  }, 1000);
}

function selectionInSection(section) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return false;
  }

  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer;
  const el = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
  return Boolean(el && section.contains(el));
}

function onTerminalBCopy() {
  state.terminalBCopied = true;
  flashPipeSourceAfterHookCopy();
  renderPipeline();
  renderSetupProgress();
  setStatus("Smoke test copied. Run it in Terminal B to verify the relay.");
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
window.localStorage.setItem(localUrlStorageKey, localUrlInput.value);

localUrlInput.addEventListener("input", () => {
  const value = localUrlInput.value.trim();
  window.localStorage.setItem(localUrlStorageKey, value);
  const didResetConfirmation = state.localUrlConfirmed;

  if (didResetConfirmation) {
    state.localUrlConfirmed = false;
  }

  if (state.session && state.selectedApp) {
    renderSession({ preserveStatus: true });

    if (didResetConfirmation) {
      setStatus("Local URL changed. Confirm it again before moving on.");
    }

    return;
  }

  renderSetupProgress();
});

modal.addEventListener("click", (event) => {
  if (!modal.open) {
    return;
  }

  const rect = modal.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  if (!inside) {
    modal.close();
  }
});

modal.addEventListener("close", () => {
  clearHookCopyTimer();
  clearStepFocusTimer();
  stopListenerStatusPolling();
});

copyScript.addEventListener("click", () =>
  copyText(listenerScript.textContent, "Terminal A listener command", copyScript, flashPipeTerminalAfterTerminalACopy),
);
copyHook.addEventListener("click", () =>
  copyText(hookUrl.textContent, "webhook URL", copyHook, () => {
    flashPipeSourceAfterHookCopy();
    queueHookStepCompletion();
  }),
);
copyCurl.addEventListener("click", () =>
  copyText(curlCommand.textContent, "Terminal B curl smoke test", copyCurl, onTerminalBCopy),
);
copyCli.addEventListener("click", () =>
  copyText(cliCommand.textContent, "CLI curl runner", copyCli, flashPipeTerminalAfterTerminalACopy),
);

if (hookSection) {
  hookSection.addEventListener("copy", () => {
    if (!modal.open || !selectionInSection(hookSection)) {
      return;
    }

    queueHookStepCompletion();
  });
}

if (terminalASection) {
  terminalASection.addEventListener("copy", () => {
    if (!modal.open || !selectionInSection(terminalASection)) {
      return;
    }

    flashPipeTerminalAfterTerminalACopy();
  });
}

if (terminalBSection) {
  terminalBSection.addEventListener("copy", () => {
    if (!modal.open || !selectionInSection(terminalBSection)) {
      return;
    }

    onTerminalBCopy();
  });
}

if (confirmLocalUrl) {
  confirmLocalUrl.addEventListener("click", () => {
    const localUrl = getCurrentLocalUrl();

    if (!tryParseLocalUrl(localUrl)) {
      setStatus("Enter a full local URL like http://localhost:3000/api/webhook, then confirm it.", true);
      focusStep(2, "auto");
      return;
    }

    state.localUrlConfirmed = true;
    renderSetupProgress();

    if (!state.hookStepComplete) {
      setStatus("Local URL confirmed. Finish step 1 by pasting the webhook URL into your app.");
    }
  });
}

for (const [step, button] of stepButtons) {
  if (!button) {
    continue;
  }

  button.addEventListener("click", () => {
    focusStep(step);
  });
}

toggleComments.addEventListener("click", () => {
  state.showComments = !state.showComments;

  if (state.session && state.selectedApp) {
    renderSession({ preserveStatus: true });
    return;
  }

  renderCommandMode();
});

renderCommandMode();
renderListenerState();
loadApps();
