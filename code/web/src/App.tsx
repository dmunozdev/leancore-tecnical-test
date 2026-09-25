import { useEffect, useMemo, useState } from 'react';
import { CONVERSATION_ID_PATTERN, DEFAULT_CONVERSATION, ROLES, type Role } from './contract';
import { RoleSelect } from './components/RoleSelect';
import { ChatView } from './components/ChatView';
import { useChat } from './hooks/useChat';
import { MockTransport } from './transport/MockTransport';

declare global {
  interface Window {
    /** Transporte simulado activo, para inyectar fallas desde la consola. */
    chatMock?: MockTransport;
  }
}

interface Route {
  role: Role | null;
  conversationId: string;
}

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');
  return {
    role: ROLES.includes(role as Role) ? (role as Role) : null,
    conversationId: params.get('conversation') || DEFAULT_CONVERSATION,
  };
}

export function App() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (!CONVERSATION_ID_PATTERN.test(route.conversationId)) {
    return (
      <main className="role-select">
        <p>
          La conversación «{route.conversationId}» no es válida. Usa minúsculas, números y guiones, hasta 64
          caracteres.
        </p>
      </main>
    );
  }

  if (route.role === null) {
    const enter = (role: Role) => {
      const params = new URLSearchParams({ role, conversation: route.conversationId });
      window.history.pushState(null, '', `?${params}`);
      setRoute({ role, conversationId: route.conversationId });
    };
    return <RoleSelect onSelect={enter} />;
  }

  return <Chat key={`${route.role}:${route.conversationId}`} role={route.role} conversationId={route.conversationId} />;
}

function Chat({ role, conversationId }: { role: Role; conversationId: string }) {
  const transport = useMemo(() => new MockTransport(role, conversationId), [role, conversationId]);

  useEffect(() => {
    window.chatMock = transport;
    return () => {
      if (window.chatMock === transport) delete window.chatMock;
    };
  }, [transport]);

  const { state, send } = useChat(transport, role);
  return <ChatView conversationId={conversationId} state={state} onSend={send} />;
}
