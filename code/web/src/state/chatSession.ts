import { MAX_TEXT_LENGTH, type Message } from '../contract';
import type { ChatTransport } from '../transport/ChatTransport';
import type { ChatAction, ChatState } from './chatReducer';
import { PendingQueue } from './pendingQueue';

export interface ChatSession {
  /** Devuelve false si el texto no es válido y no se envió. */
  send(text: string): boolean;
  dispose(): void;
}

/**
 * Conecta un ChatTransport con el estado del chat: epoch, resume, cola de pendientes y
 * estado de la conexión. No depende de React, para poder probarlo con el MockTransport.
 */
export function startChatSession(
  transport: ChatTransport,
  dispatch: (action: ChatAction) => void,
  getState: () => ChatState,
): ChatSession {
  const queue = new PendingQueue(
    (messageId, text) => transport.send({ type: 'message:send', messageId, text }),
    (messageId) => dispatch({ type: 'local:failed', messageId }),
  );

  /**
   * Un mensaje propio confirmado por el servidor (con `seq`) cuenta como ACK para la cola.
   * Se filtra por remitente: la cola indexa por `messageId`, y el de otro remitente no confirma el propio.
   */
  const confirmIfOwn = (message: Message) => {
    if (message.sender === getState().role) queue.ack(message.messageId);
  };

  const unsubscribe = transport.subscribe({
    onStatus(status) {
      dispatch({ type: 'connection', status });
      if (status !== 'open') queue.pause();
    },
    onEvent(event) {
      switch (event.type) {
        case 'welcome': {
          const { epoch, lastSeq } = getState();
          const restarted = epoch !== null && epoch !== event.epoch;
          dispatch({ type: 'welcome', epoch: event.epoch });
          transport.send({ type: 'resume', lastSeq: restarted ? 0 : lastSeq });
          break;
        }
        case 'history':
          dispatch({ type: 'history', messages: event.messages });
          // Un propio que ya viene confirmado (su ACK se perdió en la caída) no se reenvía.
          for (const m of event.messages) confirmIfOwn(m);
          // Primero el contexto, después los pendientes (decisión 5).
          queue.resume();
          break;
        case 'message:ack':
          dispatch({ type: 'message:ack', messageId: event.messageId, seq: event.seq, serverTs: event.serverTs });
          queue.ack(event.messageId);
          break;
        case 'message:new':
          dispatch({ type: 'message:new', message: event.message });
          confirmIfOwn(event.message);
          break;
        case 'error':
          if (event.messageId) queue.fail(event.messageId);
          else console.warn(`Error del servidor: ${event.code} ${event.message}`);
          break;
      }
    },
  });
  transport.connect();

  return {
    send(raw) {
      const text = raw.trim();
      if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return false;
      const messageId = crypto.randomUUID();
      dispatch({ type: 'local:send', messageId, text });
      queue.add(messageId, text);
      return true;
    },
    dispose() {
      unsubscribe();
      queue.dispose();
      transport.close();
    },
  };
}
