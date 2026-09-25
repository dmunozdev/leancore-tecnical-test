import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Role } from '../contract';
import type { ChatTransport } from '../transport/ChatTransport';
import { chatReducer, initialChatState } from '../state/chatReducer';
import { startChatSession, type ChatSession } from '../state/chatSession';

/** Estado del chat para la interfaz, sobre una sesión conectada al transporte. */
export function useChat(transport: ChatTransport, role: Role) {
  const [state, dispatch] = useReducer(chatReducer, role, initialChatState);
  const stateRef = useRef(state);
  const sessionRef = useRef<ChatSession | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const session = startChatSession(transport, dispatch, () => stateRef.current);
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [transport]);

  const send = useCallback((text: string) => sessionRef.current?.send(text) ?? false, []);

  return { state, send };
}
