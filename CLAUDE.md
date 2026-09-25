# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LeanCore technical test: a minimal real-time support chat (one customer ↔ one agent). The focus is not the UI but the classic real-time problem: messages must not be lost, must not duplicate on reconnect/retry, and both participants must see the same order.

The project is **spec-driven with OpenSpec**. As of this writing no source code exists yet — the whole plan lives in `openspec/changes/add-support-chat/`:

- `design.md` — **source of truth for the wire contract** and all architectural decisions (read it before touching code).
- `tasks.md` — ordered task list; check items off as sections are completed.
- `specs/message-delivery/spec.md` (ACK, dedup, ordering, reconnect, epoch, heartbeat) and `specs/support-conversation/spec.md` (role selection, exchange, sender, validation).
- `openspec/config.yaml` — project context, glossary, and rules for each artifact.

Implement via the `/opsx:apply` skill (or `openspec-apply-change`). Per `config.yaml`:
- Implement **only the tasks.md section requested**, not all of it at once; when done, mark its tasks and explain how to test it.
- Respect the contract in `design.md`.
- **Do not add dependencies outside the stack without asking.**
- Do not implement anything marked out of scope (auth, conversation list for agents, typing/read indicators, attachments, localStorage pending queue, Docker, real AWS deploy).
- Work order: scaffolding → contract → front with mocks → back → integration → tests → README. One commit per stage (commit messages listed at the end of `tasks.md`, Conventional Commits in Spanish).

OpenSpec artifact rules: specs are written **in Spanish**, every requirement contains **MUST** and has at least one WHEN/THEN scenario; every design decision lists options evaluated, decision, why, and discarded options; tasks carry a time estimate per section. Validate with `openspec validate add-support-chat --strict`.

## Stack and commands (planned)

- Server: Node.js + TypeScript + `ws` in `code/server`.
- Web: React + Vite + TypeScript, native browser WebSocket, in `code/web`. Vite proxies `/ws` to the server.
- Tests: Vitest (unit), Playwright (E2E reconnection).
- Node version pinned in `.nvmrc` + `engines`. No Docker.

Root `package.json` scripts (to be created in task 0.3):
- `npm run dev` — starts server and web together via `concurrently`.
- `npm run test:e2e:setup` — `npx playwright install chromium` (browser is not an npm dep).
- Playwright's `webServer` option boots server + web before E2E runs.

Update this section with the real script names once `package.json` exists.

## Architecture

### Wire contract (`contract.ts`, duplicated in `code/server/src` and `code/web/src`)

Connection: `GET /ws?role=cliente|agente&conversation=demo`. Role and conversation are fixed server-side at connect time; invalid values close with code 1008. The **server sets `sender`** — never trust a role sent in a message.

- Client → server: `resume {lastSeq}`, `message:send {messageId, text}`.
- Server → client: `welcome {epoch, conversationId, role}`, `history {messages}`, `message:ack {messageId, seq, serverTs}`, `message:new {message}`, `error {code: INVALID_PAYLOAD|INVALID_TEXT}`.
- Validation: `text` 1–2000 chars after trim; `messageId` must be a UUID.

The two `contract.ts` copies must be kept identical; `design.md` wins if they diverge.

### Delivery semantics (the core of the exercise)

- `messageId`: client-generated UUID (`crypto.randomUUID()`) **before** first send — it is the idempotency key. Server dedups per conversation: a repeated `messageId` gets the same ACK/`seq` and is **not** re-broadcast.
- `seq`: server-assigned, incremental per conversation; the **only** ordering key (`serverTs` is informational).
- Sender side: wait 5 s for ACK, retry with same `messageId`, max 3 attempts → `failed`. Local states `pending`/`sent`/`failed` never go over the wire. Pending messages render at the end and are relocated by `seq` on ACK.
- Receiver side: no per-message ACK; client tracks `lastSeq` (last contiguous seq) and sends `resume` on reconnect, **then** resends pendings.
- `epoch`: random id generated at server start, sent in `welcome`. If it changes, the client resets `lastSeq` and its list but keeps and resends pendings.
- Heartbeat: server pings every 30 s and terminates dead connections. Client reconnects with exponential backoff (1 s → 30 s cap) + up to 1 s jitter, showing "Reconectando…".

### Server — hexagonal (`code/server/src`)

- `domain/ChatService.ts`: dedup, seq assignment, fetch-after-lastSeq. No infrastructure imports.
- `domain/ports.ts`: `MessageRepository` (`append` assigns seq atomically, `findByMessageId`, `findAfter`) and `MessageNotifier` (`broadcast(conversationId, event)`).
- `adapters/InMemoryMessageRepository.ts`, `adapters/WsGateway.ts` (connections, validation, heartbeat, epoch).
- Single instance, in-memory storage; the port boundary exists so the domain could move to Lambda + DynamoDB (design decision 8) by swapping adapters only.

### Web (`code/web/src`)

- UI depends on the `ChatTransport` interface only; `WebSocketTransport` (real, with reconnection) and `MockTransport` (injects duplicates, reordering, disconnects — used to build the front before the back exists and in unit tests).
- `state/chatReducer.ts`: merge by `messageId`, sort by `seq`, pendings last.
- `hooks/useChat.ts`: epoch, `lastSeq`, pending queue, connection status.
- Initial screen offers "Entrar como cliente" / "Entrar como agente"; entering directly with URL params also works. Test with one normal tab + one incognito tab.

### Tests that must not be cut

Domain unit tests (seq increasing, repeated `messageId` → same seq, `findAfter` only returns later messages) and the Playwright E2E (two browser contexts, `setOffline(true)` on one, other sends, restore, assert no duplicates and identical order). If time runs short, cut in this order: "no agents online" auto-message, component tests, seq gap detection, reducer unit tests (see `tasks.md`).
