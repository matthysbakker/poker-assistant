// Extension message protocol — see background.ts for full type reference

const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const hotkeyEl = document.getElementById("hotkey") as HTMLElement;
const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
const pokerDot = document.getElementById("poker-dot") as HTMLElement;
const pokerStatus = document.getElementById("poker-status") as HTMLElement;
const autopilotBtn = document.getElementById(
  "autopilot-btn",
) as HTMLButtonElement;

hotkeyEl.textContent = "Ctrl+Shift+P";

let continuousActive = false;
let autopilotActive = false;

function updateToggleButton() {
  if (continuousActive) {
    toggleBtn.textContent = "Stop Continuous Capture";
    toggleBtn.classList.add("active");
  } else {
    toggleBtn.textContent = "Start Continuous Capture";
    toggleBtn.classList.remove("active");
  }
}

function updateAutopilotButton() {
  if (autopilotActive) {
    autopilotBtn.textContent = "Stop Autopilot";
    autopilotBtn.classList.add("autopilot");
  } else {
    autopilotBtn.textContent = "Start Autopilot";
    autopilotBtn.classList.remove("autopilot");
  }
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
    autopilotBtn.disabled = false;
    autopilotActive = response.autopilot ?? false;
    updateAutopilotButton();
  } else {
    pokerDot.classList.add("disconnected");
    pokerStatus.textContent = "No poker tab found";
    autopilotBtn.disabled = true;
    autopilotBtn.textContent = "Open poker first";
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

autopilotBtn.addEventListener("click", () => {
  const messageType = autopilotActive ? "AUTOPILOT_STOP" : "AUTOPILOT_START";
  autopilotBtn.disabled = true;

  const timeout = setTimeout(() => {
    autopilotBtn.disabled = false;
  }, 3000);

  chrome.runtime.sendMessage({ type: messageType }, (response) => {
    clearTimeout(timeout);
    if (response?.ok) {
      autopilotActive = response.autopilot;
      updateAutopilotButton();
    }
    autopilotBtn.disabled = false;
  });
});
