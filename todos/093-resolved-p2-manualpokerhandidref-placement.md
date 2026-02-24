---
status: pending
priority: p2
issue_id: "093"
tags: [code-review, quality]
dependencies: []
---

# manualPokerHandIdRef Declared 63 Lines After First Use + Should Be useState

## Problem Statement

Two related issues with `manualPokerHandIdRef` in `page.tsx`:

1. The ref is assigned at line 63 (`manualPokerHandIdRef.current = crypto.randomUUID()`) but declared at line 126. Top-to-bottom reading is broken — a reader hits an unknown identifier before its declaration.
2. The simplicity review suggests `useState` is more appropriate than `useRef` here: the UUID is "what hand ID was assigned when the capture arrived" — it's conceptual state, not a DOM reference or synchronization primitive.

## Findings

- `app/page.tsx:63` — `manualPokerHandIdRef.current = crypto.randomUUID()` (assignment, in message handler)
- `app/page.tsx:126` — `const manualPokerHandIdRef = useRef<string | null>(null)` (declaration, 63 lines later)
- JavaScript hoisting saves this at runtime, but the read is confusing
- The ref is only written in one place (CAPTURE handler) and read in one place (captureContext construction)
- Using `useState` would make the data flow visible to React and improve traceability
- Note: if todo 085 (snapshot ref) is implemented, this becomes a ref-to-ref move with different semantics — evaluate after 085

## Proposed Solutions

### Option 1: Move useRef declaration to top of ref block (Minimal fix)

**Approach:** Move `const manualPokerHandIdRef = useRef<string | null>(null)` to the block near `prevStreetRef` at the top of the component's ref declarations.

**Pros:**
- Minimal change, fixes top-to-bottom read order

**Cons:**
- Still uses ref semantics for what is conceptually state

**Effort:** 2 minutes

**Risk:** None

---

### Option 2: Convert to useState (Recommended)

**Approach:**
```ts
// Replace ref with state
const [manualHandId, setManualHandId] = useState<string | null>(null);

// In CAPTURE handler:
const newHandId = crypto.randomUUID();
setManualHandId(newHandId);
setImageBase64(event.data.base64);

// In captureContext:
pokerHandId: isContinuous ? handState.pokerHandId : manualHandId,
```

Note: `streamKey` increment guarantees AnalysisResult remounts before submission, so no stale closure risk.

**Pros:**
- Data flow visible to React
- Clearer semantics: "last manually captured hand ID" is state

**Cons:**
- Slightly more complex render cycle (two state updates in handler)

**Effort:** 15 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** At minimum, Option 1 (move declaration). If todo 085 is not implemented, prefer Option 2 for clarity.

## Technical Details

**Affected files:**
- `app/page.tsx:63, 126`

## Resources

- **PR:** #12
- **Related:** todo 085

## Acceptance Criteria

- [ ] `manualPokerHandIdRef` (or `manualHandId`) declared before first use in source order
- [ ] Manual-mode hand ID tracking is readable without jumping between distant lines

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (pattern-recognition-specialist + code-simplicity-reviewer agents)
