import type { Message, Role } from '../contract';
import type { ConnectionStatus } from '../transport/ChatTransport';

/** Estado local del mensaje; no viaja por la red. */
export type LocalStatus = 'pending' | 'sent' | 'failed';

export interface ChatMessage {
  messageId: string;
  sender: Role;
  text: string;
  status: LocalStatus;
  /** Solo existe cuando el servidor confirmó el mensaje. */
  seq?: number;
  serverTs?: string;
}

export interface ChatState {
  /** Rol de esta sesión: un mensaje es propio si su `sender` coincide. */
  role: Role;
  epoch: string | null;
  /** Último `seq` contiguo recibido (no el mayor). */
  lastSeq: number;
  connection: ConnectionStatus;
  /** Confirmados ordenados por `seq`, seguidos de los propios sin confirmar. */
  messages: ChatMessage[];
}

export type ChatAction =
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'welcome'; epoch: string }
  | { type: 'history'; messages: Message[] }
  | { type: 'message:new'; message: Message }
  | { type: 'message:ack'; messageId: string; seq: number; serverTs: string }
  | { type: 'local:send'; messageId: string; text: string }
  | { type: 'local:failed'; messageId: string };

export function initialChatState(role: Role): ChatState {
  return { role, epoch: null, lastSeq: 0, connection: 'connecting', messages: [] };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.status };

    case 'welcome': {
      if (state.epoch === null || state.epoch === action.epoch) return { ...state, epoch: action.epoch };
      // El servidor se reinició: su historial y sus seq ya no valen. Se conservan los propios sin confirmar.
      return {
        ...state,
        epoch: action.epoch,
        lastSeq: 0,
        messages: state.messages.filter((m) => m.seq === undefined),
      };
    }

    case 'history':
      return withMessages(state, action.messages.reduce(mergeConfirmed, state.messages));

    case 'message:new':
      return withMessages(state, mergeConfirmed(state.messages, action.message));

    case 'message:ack': {
      const { messageId, seq, serverTs } = action;
      return withMessages(
        state,
        updateOwn(state, messageId, (m) => ({ ...m, seq, serverTs, status: 'sent' })),
      );
    }

    case 'local:send':
      return {
        ...state,
        messages: [...state.messages, { messageId: action.messageId, sender: state.role, text: action.text, status: 'pending' }],
      };

    case 'local:failed':
      return {
        ...state,
        messages: updateOwn(state, action.messageId, (m) => (m.status === 'pending' ? { ...m, status: 'failed' } : m)),
      };
  }
}

const sameKey = (a: { sender: Role; messageId: string }, b: { sender: Role; messageId: string }) =>
  a.sender === b.sender && a.messageId === b.messageId;

/** Agrega un mensaje confirmado o actualiza el que ya tiene el mismo remitente y `messageId`. */
function mergeConfirmed(messages: ChatMessage[], message: Message): ChatMessage[] {
  const confirmed: ChatMessage = {
    messageId: message.messageId,
    sender: message.sender,
    text: message.text,
    status: 'sent',
    seq: message.seq,
    serverTs: message.serverTs,
  };
  const index = messages.findIndex((m) => sameKey(m, message));
  if (index === -1) return [...messages, confirmed];
  const next = messages.slice();
  next[index] = confirmed;
  return next;
}

function updateOwn(state: ChatState, messageId: string, update: (m: ChatMessage) => ChatMessage): ChatMessage[] {
  const key = { sender: state.role, messageId };
  return state.messages.map((m) => (sameKey(m, key) ? update(m) : m));
}

/** Ordena (confirmados por `seq`, luego sin confirmar en orden de envío) y avanza `lastSeq` contiguo. */
function withMessages(state: ChatState, messages: ChatMessage[]): ChatState {
  const sorted = messages.slice().sort((a, b) => {
    if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
    if (a.seq !== undefined) return -1;
    if (b.seq !== undefined) return 1;
    return 0;
  });
  const seqs = new Set(sorted.map((m) => m.seq));
  let lastSeq = state.lastSeq;
  while (seqs.has(lastSeq + 1)) lastSeq++;
  return { ...state, messages: sorted, lastSeq };
}
