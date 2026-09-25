# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

LeanCore technical test: a minimal real-time support chat (one customer ↔ one agent). The focus is not the UI but the classic real-time problem: messages must not be lost, must not duplicate on reconnect/retry, and both participants must see the same order.

The project is **spec-driven with OpenSpec** and fully implemented. There are no active changes.

- `openspec/specs/` — **current requirements** (source of truth for behavior): `message-delivery` (ACK, dedup, ordering, reconnection, epoch, heartbeat, tolerance to faulty clients) and `support-conversation` (role selection, exchange, sender, own messages, validation).
- `openspec/changes/archive/` — completed changes, each with its `proposal.md`, `design.md` (decisions with evaluated options), `tasks.md` and delta specs:
  - `2026-09-24-add-support-chat` — the whole chat. Its `design.md` holds the **wire contract** and decisions 1–9.
  - `2026-09-24-harden-delivery` — post-audit fixes: `maxPayload` 16 KiB, per-socket `error` handling, pending queue reconciled with `history`/`message:new`.
- `openspec/config.yaml` — project context, glossary, artifact rules and apply/archive guidance.
- `README.md` — how to run and test, decisions summary, known risks.

## Working rules

New work goes through OpenSpec: `/opsx:explore` → `/opsx:propose` → `/opsx:apply` → `/opsx:verify` → `/opsx:archive`. Per `config.yaml`:
- Implement **only the tasks.md section requested**; when done, mark its tasks and explain how to test it.
- Respect the contract (in the archived `add-support-chat/design.md`; both `contract.ts` copies must stay identical).
- **Do not add dependencies outside the stack without asking.**
- Do not implement anything out of scope: auth, conversation list for agents ("Cerrar conversación" included), typing/read indicators, attachments, pending queue in `localStorage`, Docker, real AWS deploy, rate limiting.
- Artifacts are written **in Spanish**: every requirement has **MUST** and at least one WHEN/THEN scenario; every design decision lists options evaluated, decision, why and discarded options; tasks carry a time estimate per section. Validate with `openspec validate <change> --strict` and `openspec validate --specs --strict`.
- Commits: Conventional Commits in Spanish (`feat(web): …`, `fix(server): …`, `test: …`, `docs: …`, `chore: …`), one per stage or part, staging only the files of that part.

## Commands

Node 24 (`.nvmrc`, `engines`). npm workspaces: `code/server` and `code/web`; one `npm install` at the root.

```bash
npm run dev             # server (ws, port 3000) + web (Vite, port 5173) via concurrently
npm test                # Vitest in both workspaces
npm run test:e2e:setup  # once per machine: downloads Chromium for Playwright
npm run test:e2e        # Playwright; webServer starts `npm run dev` (reuses it if already running)
```

- One workspace: `npm test -w code/server`, `npm run typecheck -w code/web`, `npm run dev:server`, `npm run dev:web`.
- One test file or test name: `cd code/server && npx vitest run src/adapters/WsGateway.test.ts -t "heartbeat"`; E2E: `npx playwright test e2e/entry.spec.ts`.
- Visual E2E: `npx playwright test --ui` or `--headed`.
- Mock mode without backend: `http://localhost:5173/?role=cliente&transport=mock`, then drive faults from the console with `chatMock` (`receiveFromOther`, `faults.duplicate|reorder|dropAcks`, `dropConnection(ms)`, `restartServer()`).

## Architecture

### Wire contract (`contract.ts`, duplicated in `code/server/src` and `code/web/src`)

Connection: `GET /ws?role=cliente|agente&conversation=<id>`. Missing or empty `conversation` → `demo`; must match `^[a-z0-9-]{1,64}$`. Invalid role or conversation closes with 1008. Role and conversation are fixed at connect time; the **server sets `sender`** and ignores any sender the client declares.

- Client → server: `resume {lastSeq}`, `message:send {messageId, text}`.
- Server → client: `welcome {epoch, conversationId, role}`, `history {messages}`, `message:ack {messageId, seq, serverTs}`, `message:new {message}`, `error {code: INVALID_PAYLOAD|INVALID_TEXT, messageId?}`.
- Validation: `text` 1–2000 chars after trim; `messageId` is a UUID; required fields enforced, extra fields ignored. An `error` carrying a `messageId` is final for that message ("no enviado", no retries).

### Delivery semantics (the core of the exercise)

- **Dedup key is (conversation, sender, messageId)**, on the server and in the client reducer. A retry from the same sender gets the same ACK/`seq` and is not re-broadcast; the same `messageId` from another sender is a new message.
- `seq` is server-assigned per conversation and the **only** ordering key.
- Sender: ACK timeout 5 s, 3 attempts → "no enviado". **Attempts only count while connected**: a drop pauses the timers without spending attempts, and reconnecting resets the counter.
- Reconnect flow: `welcome` → compare `epoch` → `resume {lastSeq}` → `history` → **then** resend pendings. `lastSeq` is the last **contiguous** seq (a `message:new` arriving before `history` doesn't advance it).
- A pending own message that arrives confirmed via `history` or `message:new` counts as ACKed and is not resent.
- `epoch` change (server restart): client clears confirmed messages and `lastSeq`, keeps and resends its own unconfirmed ones.
- Server: heartbeat ping every 30 s; `maxPayload` 16 KiB (largest valid message ≈ 12 KB serialized) closes with 1009; any protocol error on a socket closes only that connection (1002) and logs a `console.warn`.
- Client: exponential backoff 1 s → 30 s + up to 1 s jitter, showing "Reconectando…". Own message = `sender === role`.

### Server — hexagonal (`code/server/src`)

- `domain/ChatService.ts` + `domain/ports.ts` (`MessageRepository`, `MessageNotifier`): no infrastructure imports. Ports are **synchronous on purpose** so check-then-append stays atomic; don't make them async without moving dedup into a conditional write.
- `adapters/InMemoryMessageRepository.ts`; `adapters/WsGateway.ts` (URL validation, epoch, parsing, heartbeat, error handling; `ConnectionRegistry` implements the notifier).
- `index.ts` wires it up and listens on **`SERVER_PORT`** (default 3000), not `PORT`, because tools set `PORT` (the Claude preview sets it to 5173).
- Runs `.ts` directly with Node 24 type stripping (no `tsx`/build): only erasable syntax (no parameter properties or enums) and relative imports **with the `.ts` extension**.

### Web (`code/web/src`)

- `transport/`: `ChatTransport` interface, `WebSocketTransport` (real, reconnection), `MockTransport` (in-browser fake server with fault injection).
- `state/`: `chatReducer.ts` (merge, order, contiguous `lastSeq`, epoch reset), `pendingQueue.ts` (ACK timeout, attempts, pause/resume), `chatSession.ts` (wires transport + reducer + queue; no React, so it is unit-tested with `MockTransport` and fake timers).
- `hooks/useChat.ts` wraps the session for React; `components/` has `RoleSelect` and `ChatView`; `App.tsx` routes by URL (`role`, `conversation`, `transport=mock`).
- Vite proxies `/ws` to `ws://localhost:3000` and uses `strictPort` 5173.

## Testing notes

- Server: `ChatService.test.ts` (domain) and `WsGateway.test.ts` (real `ws` clients on a free port, 100 ms heartbeat; includes a raw `net.Socket` sending an unmasked frame). Web: `chatReducer.test.ts`, `chatSession.test.ts`. E2E: `e2e/reconnection.spec.ts`, `e2e/entry.spec.ts`.
- **Chromium `setOffline(true)` does not close an already-open WebSocket.** The reconnection E2E also cuts the socket with `routeWebSocket` and asserts "Reconectando…" before continuing; keep that assertion so the test cannot pass without a real drop. DevTools "Offline" has the same limitation for manual tests.
- E2E runs use a unique `conversation` per run because the in-memory server may be reused.
- `crypto.randomUUID` needs a secure context: the front works on `localhost` or https, not over plain http on a LAN IP.
- Expected noise: Vite's `ws proxy socket error` (ECONNABORTED/ECONNRESET) when connections drop, and failed-WebSocket logs while the server is down.
- When starting servers in the background for diagnostics, kill the whole process tree afterwards (a surviving `node --watch` restarts the server on the next file edit and keeps port 3000 busy).
