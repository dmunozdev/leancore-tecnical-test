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

  /** Entra con un rol, o vuelve a la pantalla inicial con `null`. La conversación se conserva en la URL. */
  const selectRole = (role: Role | null) => {
    const params = new URLSearchParams({ conversation: route.conversationId });
    if (role) params.set('role', role);
    window.history.pushState(null, '', `?${params}`);
    setRoute({ role, conversationId: route.conversationId });
  };

  if (route.role === null) return <RoleSelect onSelect={selectRole} />;

  return (
    <Chat
      key={`${route.role}:${route.conversationId}`}
      role={route.role}
      conversationId={route.conversationId}
      onChangeRole={() => selectRole(null)}
    />
  );
}

function Chat({ role, conversationId, onChangeRole }: { role: Role; conversationId: string; onChangeRole: () => void }) {
  const transport = useMemo(() => new MockTransport(role, conversationId), [role, conversationId]);

  useEffect(() => {
    window.chatMock = transport;
    return () => {
      if (window.chatMock === transport) delete window.chatMock;
    };
  }, [transport]);

  const { state, send } = useChat(transport, role);
  return <ChatView state={state} onSend={send} onChangeRole={onChangeRole} />;
}
