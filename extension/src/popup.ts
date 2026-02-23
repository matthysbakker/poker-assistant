// Extension message protocol — see background.ts for full type reference

const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const hotkeyEl = document.getElementById("hotkey") as HTMLElement;
const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
const pokerDot = document.getElementById("poker-dot") as HTMLElement;
const pokerStatus = document.getElementById("poker-status") as HTMLElement;
const monitorBtn = document.getElementById("monitor-btn") as HTMLButtonElement;
const playBtn = document.getElementById("play-btn") as HTMLButtonElement;

hotkeyEl.textContent = "Ctrl+Shift+P";

let continuousActive = false;
let currentMode: "off" | "monitor" | "play" = "off";

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
    currentMode = response.autopilotMode ?? "off";
    updateModeButtons();
  } else {
    pokerDot.classList.add("disconnected");
    pokerStatus.textContent = "No poker tab found";
    monitorBtn.disabled = true;
    playBtn.disabled = true;
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
