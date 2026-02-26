// Extension message protocol — see background.ts for full type reference

const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const hotkeyEl = document.getElementById("hotkey") as HTMLElement;
const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
const pokerDot = document.getElementById("poker-dot") as HTMLElement;
const pokerStatus = document.getElementById("poker-status") as HTMLElement;
const monitorBtn = document.getElementById("monitor-btn") as HTMLButtonElement;
const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const inspectBtn = document.getElementById("inspect-btn") as HTMLButtonElement;
const inspectReportBtn = document.getElementById("inspect-report-btn") as HTMLButtonElement;
const inspectorResult = document.getElementById("inspector-result") as HTMLElement;

hotkeyEl.textContent = "Ctrl+Shift+P";

let continuousActive = false;
let currentMode: "off" | "monitor" | "play" = "off";
let inspectorRunning = false;

function updateToggleButton() {
  if (continuousActive) {
    toggleBtn.textContent = "Stop Continuous Capture";
    toggleBtn.classList.add("active");
  } else {
    toggleBtn.textContent = "Start Continuous Capture";
    toggleBtn.classList.remove("active");
  }
}

function updateModeButtons() {
  monitorBtn.classList.toggle("monitor", currentMode === "monitor");
  playBtn.classList.toggle("play", currentMode === "play");
  monitorBtn.textContent = currentMode === "monitor" ? "Stop Monitor" : "Monitor";
  playBtn.textContent = currentMode === "play" ? "Stop Play" : "Play";
}

function setMode(mode: "off" | "monitor" | "play") {
  monitorBtn.disabled = true;
  playBtn.disabled = true;

  const timeout = setTimeout(() => {
    monitorBtn.disabled = false;
    playBtn.disabled = false;
  }, 3000);

  chrome.runtime.sendMessage(
    { type: "AUTOPILOT_SET_MODE", mode },
    (response) => {
      clearTimeout(timeout);
      if (response?.ok) {
        currentMode = response.autopilotMode;
        updateModeButtons();
      }
      monitorBtn.disabled = false;
      playBtn.disabled = false;
    },
  );
}

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  // Web app connection status
  if (response?.connected) {
    statusDot.classList.add("connected");
    statusText.textContent = "Connected to Poker Analyzer";
    toggleBtn.disabled = false;
    continuousActive = response.continuous ?? false;
    updateToggleButton();
  } else {
    statusDot.classList.add("disconnected");
    statusText.textContent = "Open localhost to connect";
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Connect first";
  }

  // Poker tab connection status
  if (response?.pokerConnected) {
    pokerDot.classList.add("connected");
    pokerStatus.textContent = "Poker tab detected";
    monitorBtn.disabled = false;
    playBtn.disabled = false;
    inspectBtn.disabled = false;
    inspectReportBtn.disabled = false;
    currentMode = response.autopilotMode ?? "off";
    updateModeButtons();
  } else {
    pokerDot.classList.add("disconnected");
    pokerStatus.textContent = "No poker tab found";
    monitorBtn.disabled = true;
    playBtn.disabled = true;
    inspectBtn.disabled = true;
    inspectReportBtn.disabled = true;
  }
});

toggleBtn.addEventListener("click", () => {
  const messageType = continuousActive ? "CONTINUOUS_STOP" : "CONTINUOUS_START";
  toggleBtn.disabled = true;

  const timeout = setTimeout(() => {
    toggleBtn.disabled = false;
  }, 3000);

  chrome.runtime.sendMessage({ type: messageType }, (response) => {
    clearTimeout(timeout);
    if (response?.ok) {
      continuousActive = response.continuous;
      updateToggleButton();
    }
    toggleBtn.disabled = false;
  });
});

monitorBtn.addEventListener("click", () => {
  setMode(currentMode === "monitor" ? "off" : "monitor");
});

playBtn.addEventListener("click", () => {
  setMode(currentMode === "play" ? "off" : "play");
});

// ── Inspector buttons ────────────────────────────────────────────────────────

function updateInspectorButtons() {
  inspectBtn.textContent = inspectorRunning ? "Stop Inspect" : "Inspect Log";
  inspectBtn.classList.toggle("inspector-active", inspectorRunning);
}

inspectBtn.addEventListener("click", () => {
  const msgType = inspectorRunning ? "ACTION_INSPECTOR_STOP" : "ACTION_INSPECTOR_START";
  inspectorRunning = !inspectorRunning;
  updateInspectorButtons();
  chrome.runtime.sendMessage({ type: msgType });
});

inspectReportBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ACTION_INSPECTOR_REPORT" });
});

// Listen for results forwarded from the background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "ACTION_INSPECTOR_RESULT") return;
  inspectorResult.style.display = "block";
  const all = (message.all as Array<{ sel: string; count: number; minDepth: number; example: string }>) ?? [];
  const rows = all.map(({ sel, count, minDepth, example }, i) =>
    `<div>${i + 1}. <b style="color:#e4e4e7">${sel}</b> — ${count} hits, depth ${minDepth}<br>
     <span style="color:#71717a">${example}</span></div>`,
  ).join("");
  inspectorResult.innerHTML =
    `<span class="best">${message.best} (${message.hits} hits)</span>` +
    `<div style="color:#71717a;margin-bottom:4px;font-size:10px">${message.example}</div>` +
    rows;
});
