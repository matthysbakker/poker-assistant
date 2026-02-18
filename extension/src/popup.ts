const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const hotkeyEl = document.getElementById("hotkey") as HTMLElement;
const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;

hotkeyEl.textContent = "Ctrl+Shift+P";

let continuousActive = false;

function updateToggleButton() {
  if (continuousActive) {
    toggleBtn.textContent = "Stop Continuous Capture";
    toggleBtn.classList.add("active");
  } else {
    toggleBtn.textContent = "Start Continuous Capture";
    toggleBtn.classList.remove("active");
  }
}

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
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
});

toggleBtn.addEventListener("click", () => {
  const messageType = continuousActive ? "CONTINUOUS_STOP" : "CONTINUOUS_START";
  toggleBtn.disabled = true;

  chrome.runtime.sendMessage({ type: messageType }, (response) => {
    if (response?.ok) {
      continuousActive = response.continuous;
      updateToggleButton();
    }
    toggleBtn.disabled = false;
  });
});
