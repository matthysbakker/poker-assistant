---
status: pending
priority: p3
issue_id: "096"
tags: [code-review, security, quality]
dependencies: []
---

# postMessage Handler Has No Client-Side Base64 Size Check

## Problem Statement

The `postMessage` handler in `page.tsx` forwards `event.data.base64` to `setImageBase64` without checking its size. The 10 MB guard exists only server-side in the Zod schema. A same-origin script (injected iframe, malicious extension content script) can craft a `CAPTURE` message with oversized data and trigger repeated expensive API calls.

## Findings

- `app/page.tsx:57-64` — `event.data.base64` forwarded directly to `setImageBase64` without length check
- Origin check is correct (`event.origin === window.location.origin`)
- Source check is correct (`event.data.source === "poker-extension"`)
- But `event.data.base64.length` is not checked before setting state
- The 10 MB Zod limit in `route.ts` would reject oversized requests, but the client-side cost (React re-render, AI SDK call initiation, network overhead) is incurred first

## Proposed Solutions

### Option 1: Add client-side length check (Recommended)

**Approach:**
```ts
// In message handler, after source check:
const MAX_BASE64_SIZE = 14_000_000; // ~10MB as base64 + headroom
if (typeof event.data.base64 !== 'string' || event.data.base64.length > MAX_BASE64_SIZE) {
  console.warn('Rejected oversized or invalid base64 capture');
  return;
}
```

**Pros:**
- Prevents client-side overhead from malformed messages
- Defense in depth

**Cons:**
- Minor additional code

**Effort:** 10 minutes

**Risk:** None

---

## Recommended Action

**To be filled during triage.** Low priority but simple to add.

## Technical Details

**Affected files:**
- `app/page.tsx:57-64`

## Resources

- **PR:** #12

## Acceptance Criteria

- [ ] `event.data.base64` length checked before calling `setImageBase64`
- [ ] Oversized payloads logged and rejected client-side

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)
