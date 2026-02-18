let webAppTabId: number | null = null;
let lastCaptureTime = 0;
const DEBOUNCE_MS = 3000;

// Continuous capture state
let captureInterval: ReturnType<typeof setInterval> | null = null;
let pokerWindowId: number | null = null;

console.log("[BG] Background script started");

function setBadge(text: string, color: string, timeout = 3000) {
  chrome.browserAction.setBadgeText({ text });
  chrome.browserAction.setBadgeBackgroundColor({ color });
  if (timeout > 0) {
    setTimeout(() => chrome.browserAction.setBadgeText({ text: "" }), timeout);
  }
}

function sendFrame(base64: string, type: "POKER_CAPTURE" | "CAPTURE_FRAME") {
  if (!webAppTabId) return;
  chrome.tabs.sendMessage(webAppTabId, { type, base64 }, () => {
    if (chrome.runtime.lastError) {
      console.error("[BG] Send failed:", chrome.runtime.lastError.message);
      webAppTabId = null;
      setBadge("!", "#ef4444");
      if (type === "CAPTURE_FRAME") stopContinuousCapture();
    }
  });
}

function startContinuousCapture() {
  if (captureInterval) return; // already running

  // Record the current window as the poker window
  chrome.windows.getCurrent((win) => {
    pokerWindowId = win?.id ?? null;
    console.log("[BG] Continuous capture started, poker window:", pokerWindowId);
  });

  captureInterval = setInterval(() => {
    if (!webAppTabId || !pokerWindowId) return;

    chrome.tabs.captureVisibleTab(
      pokerWindowId,
      { format: "jpeg", quality: 85 },
      (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) return;
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
        sendFrame(base64, "CAPTURE_FRAME");
      },
    );
  }, 2000);

  setBadge("ON", "#22c55e", 0); // persistent badge
}

function stopContinuousCapture() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  pokerWindowId = null;
  console.log("[BG] Continuous capture stopped");
  chrome.browserAction.setBadgeText({ text: "" });
}

function isContinuousActive() {
  return captureInterval !== null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[BG] Message:", message.type, "from tab:", sender.tab?.id);

  if (message.type === "REGISTER_WEB_APP" && sender.tab?.id) {
    webAppTabId = sender.tab.id;
    console.log("[BG] Web app tab registered:", webAppTabId);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "UNREGISTER_WEB_APP") {
    if (sender.tab?.id === webAppTabId) {
      webAppTabId = null;
      stopContinuousCapture();
      console.log("[BG] Web app tab unregistered");
    }
    return;
  }

  if (message.type === "GET_STATUS") {
    sendResponse({
      connected: webAppTabId !== null,
      continuous: isContinuousActive(),
    });
    return;
  }

  if (message.type === "CONTINUOUS_START") {
    startContinuousCapture();
    sendResponse({ ok: true, continuous: true });
    return;
  }

  if (message.type === "CONTINUOUS_STOP") {
    stopContinuousCapture();
    sendResponse({ ok: true, continuous: false });
    return;
  }
});

// Manual hotkey capture (still works alongside continuous mode)
chrome.commands.onCommand.addListener((command) => {
  console.log("[BG] Command:", command);
  if (command !== "capture-hand") return;

  const now = Date.now();
  if (now - lastCaptureTime < DEBOUNCE_MS) return;
  lastCaptureTime = now;

  if (webAppTabId === null) {
    console.log("[BG] No web app tab");
    setBadge("!", "#ef4444");
    return;
  }

  console.log("[BG] Manual capture...");
  chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error("[BG] Capture error:", chrome.runtime.lastError.message);
      setBadge("!", "#ef4444");
      return;
    }

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    console.log("[BG] Manual capture, sending to tab", webAppTabId);
    sendFrame(base64, "POKER_CAPTURE");
    setBadge("OK", "#22c55e");
  });
});
