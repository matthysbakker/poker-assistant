const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const hotkeyEl = document.getElementById("hotkey") as HTMLElement;

const isMac = navigator.platform.toUpperCase().includes("MAC");
hotkeyEl.textContent = isMac ? "Ctrl+Shift+P" : "Ctrl+Shift+P";

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  if (response?.connected) {
    statusDot.classList.add("connected");
    statusText.textContent = "Connected to Poker Analyzer";
  } else {
    statusDot.classList.add("disconnected");
    statusText.textContent = "Open localhost to connect";
  }
});
