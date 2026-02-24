/**
 * Extension message protocol (cross-reference: content.ts, popup.ts, app/page.tsx)
 *
 * Background ↔ Content (chrome.runtime messages):
 *   REGISTER_WEB_APP    content → bg     Tab registers as the web app
 *   UNREGISTER_WEB_APP  content → bg     Tab unregisters on unload
 *   POKER_CAPTURE       bg → content     Manual hotkey screenshot (PNG)
 *   CAPTURE_FRAME       bg → content     Continuous capture frame (JPEG 85%)
 *
 * Background ↔ Poker Content (chrome.runtime messages):
 *   REGISTER_POKER_TAB    poker-content → bg   Tab registers as the poker tab
 *   UNREGISTER_POKER_TAB  poker-content → bg   Tab unregisters on unload
 *   AUTOPILOT_DECIDE      poker-content → bg   Request decision (messages array)
 *   AUTOPILOT_ACTION         bg → poker-content   Decision result (action object)
 *   AUTOPILOT_MODE           bg → poker-content   Apply mode change ("off"|"monitor"|"play")
 *   PERSONA_RECOMMENDATION   content → bg → poker-content   Auto-selected persona for current hand
 *
 * Background ↔ Popup (chrome.runtime messages):
 *   GET_STATUS          popup → bg       Query connection + continuous + autopilot state
 *   CONTINUOUS_START    popup → bg       Start continuous capture
 *   CONTINUOUS_STOP     popup → bg       Stop continuous capture
 *   AUTOPILOT_SET_MODE  popup → bg       Set mode: "off" | "monitor" | "play"
 *
 * Content ↔ Page (window.postMessage, source: "poker-assistant-ext"):
 *   EXTENSION_CONNECTED content → page   Extension presence announcement
 *   CAPTURE             content → page   Manual capture for analysis
 *   FRAME               content → page   Continuous capture frame for detection
 *
 * Page → Content (window.postMessage, source: "poker-assistant-app"):
 *   PING                page → content   Request EXTENSION_CONNECTED reply
 */

let webAppTabId: number | null = null;
let lastCaptureTime = 0;
const DEBOUNCE_MS = 3000;

// Continuous capture state
let captureInterval: ReturnType<typeof setInterval> | null = null;
let pokerWindowId: number | null = null;

// Autopilot state
let pokerTabId: number | null = null;
let autopilotMode: "off" | "monitor" | "play" = "off";
const AUTOPILOT_API_URL = "http://localhost:3006/api/autopilot";
const DECISION_API_URL = "http://localhost:3006/api/decision";

console.log("[BG] Background script started");

let badgeTimeoutId: ReturnType<typeof setTimeout> | null = null;

function setBadge(text: string, color: string, timeout = 3000) {
  if (badgeTimeoutId) {
    clearTimeout(badgeTimeoutId);
    badgeTimeoutId = null;
  }
  chrome.browserAction.setBadgeText({ text });
  chrome.browserAction.setBadgeBackgroundColor({ color });
  if (timeout > 0) {
    badgeTimeoutId = setTimeout(() => {
      badgeTimeoutId = null;
      // Restore persistent badge based on active mode
      if (autopilotMode !== "off") {
        chrome.browserAction.setBadgeText({ text: "AP" });
        chrome.browserAction.setBadgeBackgroundColor({ color: "#8b5cf6" });
      } else if (isContinuousActive()) {
        chrome.browserAction.setBadgeText({ text: "ON" });
        chrome.browserAction.setBadgeBackgroundColor({ color: "#22c55e" });
      } else {
        chrome.browserAction.setBadgeText({ text: "" });
      }
    }, timeout);
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

  // Record the current window as the poker window, then start interval
  chrome.windows.getCurrent((win) => {
    pokerWindowId = win?.id ?? null;
    if (!pokerWindowId) {
      console.error("[BG] No window found for continuous capture");
      return;
    }

    console.log("[BG] Continuous capture started, poker window:", pokerWindowId);

    captureInterval = setInterval(() => {
      if (!webAppTabId) return;

      chrome.tabs.captureVisibleTab(
        pokerWindowId!,
        { format: "jpeg", quality: 85 },
        (dataUrl) => {
          if (chrome.runtime.lastError || !dataUrl) return;
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
          sendFrame(base64, "CAPTURE_FRAME");
        },
      );
    }, 1000);

    setBadge("ON", "#22c55e", 0); // persistent badge
  });
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

async function fetchAutopilotDecision(
  messages: Array<{ role: string; content: string }>,
) {
  try {
    const res = await fetch(AUTOPILOT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      console.error("[BG] Autopilot API error:", res.status);
      sendFallbackAction("API returned " + res.status);
      return;
    }

    const action = await res.json();

    // Validate shape before forwarding to real-money DOM executor (todo 038)
    const validActions = ["FOLD", "CHECK", "CALL", "RAISE", "BET"];
    if (
      !action ||
      !validActions.includes(action.action) ||
      (action.amount !== null && !Number.isFinite(action.amount)) ||
      typeof action.reasoning !== "string"
    ) {
      console.error("[BG] Invalid action shape from API:", action);
      sendFallbackAction("Invalid action shape");
      return;
    }

    console.log(
      `[BG] Autopilot decision: ${action.action}${action.amount ? ` €${action.amount}` : ""} — ${action.reasoning}`,
    );

    if (pokerTabId) {
      chrome.tabs.sendMessage(pokerTabId, {
        type: "AUTOPILOT_ACTION",
        action,
      });
    }
  } catch (err) {
    console.error("[BG] Autopilot fetch failed:", err);
    sendFallbackAction("Network error");
  }
}

function sendFallbackAction(reason: string) {
  const fallback = {
    action: "FOLD",
    amount: null,
    reasoning: `Auto-fold: ${reason}`,
  };
  if (pokerTabId) {
    chrome.tabs.sendMessage(pokerTabId, {
      type: "AUTOPILOT_ACTION",
      action: fallback,
    });
  }
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
      pokerConnected: pokerTabId !== null,
      autopilotMode,
    });
    return;
  }

  if (message.type === "CONTINUOUS_START") {
    if (autopilotMode === "play") {
      console.log("[BG] Ignoring continuous start — autopilot play mode is active");
      sendResponse({ ok: false, continuous: false });
      return;
    }
    startContinuousCapture();
    sendResponse({ ok: true, continuous: true });
    return;
  }

  if (message.type === "CONTINUOUS_STOP") {
    stopContinuousCapture();
    sendResponse({ ok: true, continuous: false });
    return;
  }

  // ── Autopilot Messages ──────────────────────────────────────────────

  if (message.type === "REGISTER_POKER_TAB" && sender.tab?.id) {
    pokerTabId = sender.tab.id;
    console.log("[BG] Poker tab registered:", pokerTabId);
    // If autopilot was already active (e.g. page reload), re-send mode
    if (autopilotMode !== "off") {
      chrome.tabs.sendMessage(pokerTabId, {
        type: "AUTOPILOT_MODE",
        mode: autopilotMode,
      });
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "UNREGISTER_POKER_TAB") {
    if (sender.tab?.id === pokerTabId) {
      pokerTabId = null;
      console.log("[BG] Poker tab unregistered");
    }
    return;
  }

  if (message.type === "AUTOPILOT_SET_MODE") {
    const newMode = message.mode as "off" | "monitor" | "play";
    if (newMode === "play" && isContinuousActive()) {
      stopContinuousCapture();
      console.log("[BG] Stopped continuous capture for autopilot play mode");
    }
    autopilotMode = newMode;
    console.log("[BG] Autopilot mode:", autopilotMode);
    if (pokerTabId) {
      chrome.tabs.sendMessage(pokerTabId, {
        type: "AUTOPILOT_MODE",
        mode: autopilotMode,
      });
    }
    if (autopilotMode === "play") {
      setBadge("AP", "#8b5cf6", 0);
    } else if (autopilotMode === "monitor") {
      setBadge("MN", "#3b82f6", 0);
    } else {
      chrome.browserAction.setBadgeText({ text: "" });
    }
    sendResponse({ ok: true, autopilotMode });
    return;
  }

  if (message.type === "AUTOPILOT_DECIDE") {
    if (sender.tab?.id !== pokerTabId) {
      console.warn("[BG] AUTOPILOT_DECIDE from unregistered tab, ignoring");
      return;
    }
    console.log("[BG] Autopilot decision requested");
    fetchAutopilotDecision(message.messages);
    return;
  }

  if (message.type === "PERSONA_RECOMMENDATION") {
    if (pokerTabId) {
      chrome.tabs.sendMessage(pokerTabId, {
        type: "PERSONA_RECOMMENDATION",
        personaName: message.personaName,
        action: message.action,
        temperature: message.temperature,
      });
    }
    return;
  }

  if (message.type === "CLAUDE_ADVICE") {
    if (pokerTabId) {
      chrome.tabs.sendMessage(pokerTabId, {
        type: "CLAUDE_ADVICE",
        action: message.action,
        amount: message.amount,
        street: message.street,
        boardTexture: message.boardTexture,
        spr: message.spr,
      });
    }
    return;
  }

  if (message.type === "LOCAL_DECISION") {
    // Forward local engine decision to the web app for logging and agent observability.
    // Fire-and-forget: failure here must not block the poker tab's autopilot path.
    fetch(DECISION_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    }).catch((err) => {
      console.warn("[BG] LOCAL_DECISION forward failed (server may be off):", err);
    });
    return;
  }

  if (message.type === "AUTOPILOT_DEBUG") {
    // Log full state to background console
    console.log("[BG] Debug:", message.data?.type);
    console.log("[BG] State:", JSON.stringify(message.data?.state, null, 2));
    if (message.data?.dom) {
      console.log("[BG] Hero DOM:", message.data.dom.heroCards);
      console.log("[BG] Actions DOM:", message.data.dom.actionsArea);
    }
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
