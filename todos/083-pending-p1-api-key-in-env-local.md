---
status: pending
priority: p1
issue_id: "083"
tags: [code-review, security]
dependencies: []
---

# Rotate Anthropic API Key Exposed in .env.local

## Problem Statement

A live Anthropic API key (`sk-ant-api03-Mz6qsSY5…`) is present in `.env.local` on disk. The `.gitignore` rule prevents it from being committed but does not limit access to anyone with filesystem access. The key must be rotated immediately before any other work on this branch.

## Findings

- `.env.local:1` contains a real, live `ANTHROPIC_API_KEY` value
- `.gitignore` only prevents git commits — the file is readable by any process with filesystem access, collaborators, IDEs, and any tool that reads `.env.local`
- Direct financial exposure: full Anthropic API access for any party who reads the file
- Security agent confirmed the key is present and unredacted

## Proposed Solutions

### Option 1: Rotate the Key (Required)

**Approach:** Go to console.anthropic.com → API Keys → revoke the current key → create a new one → update `.env.local` with the new value.

**Pros:**
- Eliminates the exposure window for the leaked key

**Cons:**
- None — this is non-optional

**Effort:** 5 minutes

**Risk:** None (rotating is always safe)

---

### Option 2: Add .env.local to explicit .gitignore with warning comment

**Approach:** After rotating, add a comment to `.env.local.example` warning never to put real keys in `.env.local` and to use environment managers.

**Pros:**
- Adds documentation layer

**Cons:**
- Does not prevent local exposure

**Effort:** 5 minutes

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Rotate the API key via console.anthropic.com immediately, then update `.env.local` with the new key. This must happen before merging PR #12.

## Technical Details

**Affected files:**
- `.env.local:1` — contains live key

**Related components:**
- `lib/ai/analyze-hand.ts` — uses `ANTHROPIC_API_KEY` env var

**Database changes (if any):**
- Migration needed? No

## Resources

- **PR:** #12
- **Anthropic Console:** https://console.anthropic.com/settings/keys

## Acceptance Criteria

- [ ] Old API key rotated via Anthropic console
- [ ] `.env.local` updated with new key
- [ ] Verify the old key no longer works

## Work Log

### 2026-02-24 - Discovery

**By:** Claude Code (security-sentinel agent)

**Actions:**
- Found live API key in `.env.local:1` during PR #12 security review

**Learnings:**
- `.gitignore` does not protect local files from being read
