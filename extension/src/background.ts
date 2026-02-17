let webAppTabId: number | null = null;
let lastCaptureTime = 0;
const DEBOUNCE_MS = 3000;

console.log("[BG] Background script started");

function setBadge(text: string, color: string) {
  chrome.browserAction.setBadgeText({ text });
  chrome.browserAction.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.browserAction.setBadgeText({ text: "" }), 3000);
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
      console.log("[BG] Web app tab unregistered");
    }
    return;
  }

  if (message.type === "GET_STATUS") {
    sendResponse({ connected: webAppTabId !== null });
    return;
  }
});

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

  console.log("[BG] Capturing...");
  chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error("[BG] Capture error:", chrome.runtime.lastError.message);
      setBadge("!", "#ef4444");
      return;
    }

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    console.log("[BG] Captured, sending to tab", webAppTabId, "length:", base64.length);

    chrome.tabs.sendMessage(webAppTabId!, { type: "POKER_CAPTURE", base64 }, () => {
      if (chrome.runtime.lastError) {
        console.error("[BG] Send failed:", chrome.runtime.lastError.message);
        webAppTabId = null;
        setBadge("!", "#ef4444");
      } else {
        console.log("[BG] Sent OK");
        setBadge("OK", "#22c55e");
      }
    });
  });
});
