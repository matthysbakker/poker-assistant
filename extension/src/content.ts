console.log("[Content] Loaded on", window.location.href);

// Register with background
chrome.runtime.sendMessage({ type: "REGISTER_WEB_APP" }, (response) => {
  if (chrome.runtime.lastError) {
    console.error("[Content] Register failed:", chrome.runtime.lastError.message);
  } else {
    console.log("[Content] Registered:", response);
  }
});

// Unregister on unload
window.addEventListener("beforeunload", () => {
  chrome.runtime.sendMessage({ type: "UNREGISTER_WEB_APP" });
});

// Tell the page we're here
window.postMessage({ source: "poker-assistant-ext", type: "EXTENSION_CONNECTED" }, "*");

// Respond to pings
window.addEventListener("message", (event) => {
  if (event.data?.source === "poker-assistant-app" && event.data.type === "PING") {
    console.log("[Content] Got PING, responding");
    window.postMessage({ source: "poker-assistant-ext", type: "EXTENSION_CONNECTED" }, "*");
  }
});

// Relay captures from background to page
chrome.runtime.onMessage.addListener((message) => {
  console.log("[Content] From background:", message.type);

  if (message.type === "POKER_CAPTURE") {
    // Manual hotkey capture → immediate analysis
    window.postMessage(
      { source: "poker-assistant-ext", type: "CAPTURE", base64: message.base64 },
      "*"
    );
  } else if (message.type === "CAPTURE_FRAME") {
    // Continuous capture frame → state machine processing
    window.postMessage(
      { source: "poker-assistant-ext", type: "FRAME", base64: message.base64 },
      "*"
    );
  }
});
