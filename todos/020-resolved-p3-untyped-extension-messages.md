---
status: resolved
priority: p3
issue_id: "020"
tags: [code-review, type-safety, extension]
---

# Extension message types untyped across 4 files

## Problem Statement
11 distinct message types scattered across background.ts, content.ts, popup.ts, and page.tsx, all matched by string comparison. A typo would silently fail.

## Files
- `extension/src/background.ts`, `extension/src/content.ts`, `extension/src/popup.ts`, `app/page.tsx`

## Proposed Fix
Create a shared type definition for message types. Since the extension builds separately, at minimum add a comment cross-referencing all message types.
