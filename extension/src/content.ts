// Extension message protocol — see background.ts for full type reference

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
window.postMessage({ source: "poker-assistant-ext", type: "EXTENSION_CONNECTED" }, window.location.origin);

// Relay page → background messages
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== "poker-assistant-app") return;

  if (event.data.type === "PING") {
    console.log("[Content] Got PING, responding");
    window.postMessage({ source: "poker-assistant-ext", type: "EXTENSION_CONNECTED" }, window.location.origin);
  }

  // Forward persona recommendation to background, which relays to the poker tab (todo 050)
  if (event.data.type === "PERSONA_RECOMMENDATION") {
    chrome.runtime.sendMessage({
      type: "PERSONA_RECOMMENDATION",
      personaName: event.data.personaName,
      action: event.data.action,
      temperature: event.data.temperature,
    });
  }

  // Forward Claude's completed advice to the poker overlay
  if (event.data.type === "CLAUDE_ADVICE") {
    chrome.runtime.sendMessage({
      type: "CLAUDE_ADVICE",
      action: event.data.action,
      amount: event.data.amount,
      street: event.data.street,
      boardTexture: event.data.boardTexture,
      spr: event.data.spr,
    });
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
