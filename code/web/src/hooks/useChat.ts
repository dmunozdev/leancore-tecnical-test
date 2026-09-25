import { useCallback, useEffect, useReducer, useRef } from 'react';
import { MAX_TEXT_LENGTH, type Role } from '../contract';
import type { ChatTransport } from '../transport/ChatTransport';
import { chatReducer, initialChatState } from '../state/chatReducer';
import { PendingQueue } from '../state/pendingQueue';

/**
 * Conecta la interfaz con un ChatTransport: epoch, lastSeq, resume, cola de pendientes
 * y estado de la conexión.
 */
export function useChat(transport: ChatTransport, role: Role) {
  const [state, dispatch] = useReducer(chatReducer, role, initialChatState);
  const stateRef = useRef(state);
  const queueRef = useRef<PendingQueue | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const queue = new PendingQueue(
      (messageId, text) => transport.send({ type: 'message:send', messageId, text }),
      (messageId) => dispatch({ type: 'local:failed', messageId }),
    );
    queueRef.current = queue;

    const unsubscribe = transport.subscribe({
      onStatus(status) {
        dispatch({ type: 'connection', status });
        if (status !== 'open') queue.pause();
      },
      onEvent(event) {
        switch (event.type) {
          case 'welcome': {
            const { epoch, lastSeq } = stateRef.current;
            const restarted = epoch !== null && epoch !== event.epoch;
            dispatch({ type: 'welcome', epoch: event.epoch });
            transport.send({ type: 'resume', lastSeq: restarted ? 0 : lastSeq });
            break;
          }
          case 'history':
            dispatch({ type: 'history', messages: event.messages });
            // Primero el contexto, después los pendientes (decisión 5).
            queue.resume();
            break;
          case 'message:ack':
            dispatch({ type: 'message:ack', messageId: event.messageId, seq: event.seq, serverTs: event.serverTs });
            queue.ack(event.messageId);
            break;
          case 'message:new':
            dispatch({ type: 'message:new', message: event.message });
            break;
          case 'error':
            if (event.messageId) queue.fail(event.messageId);
            else console.warn(`Error del servidor: ${event.code} ${event.message}`);
            break;
        }
      },
    });
    transport.connect();

    return () => {
      unsubscribe();
      queue.dispose();
      transport.close();
      queueRef.current = null;
    };
  }, [transport]);

  /** Devuelve false si el texto no es válido y no se envió. */
  const send = useCallback((raw: string): boolean => {
    const text = raw.trim();
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return false;
    const messageId = crypto.randomUUID();
    dispatch({ type: 'local:send', messageId, text });
    queueRef.current?.add(messageId, text);
    return true;
  }, []);

  return { state, send };
}
