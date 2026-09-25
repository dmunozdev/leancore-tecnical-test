import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_TEXT_LENGTH, type Role } from '../contract';
import type { ChatState, LocalStatus } from '../state/chatReducer';
import type { ConnectionStatus } from '../transport/ChatTransport';

const STATUS_LABEL: Record<LocalStatus, string> = {
  pending: 'enviando',
  sent: 'enviado',
  failed: 'no enviado',
};

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  open: 'Conectado',
  reconnecting: 'Reconectando…',
};

const ROLE_LABEL: Record<Role, string> = { cliente: 'Cliente', agente: 'Agente' };

const PLACEHOLDER: Record<Role, string> = {
  cliente: 'Escribe un mensaje…',
  agente: 'Responde al cliente…',
};

interface Props {
  state: ChatState;
  onSend: (text: string) => boolean;
  onChangeRole: () => void;
}

export function ChatView({ state, onSend, onChangeRole }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [state.messages.length]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (onSend(draft)) setDraft('');
  };

  // Enter envía; Shift+Enter hace salto de línea. Se respeta la composición de acentos (IME).
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">Chat de soporte</h1>
        <span className="badge">{ROLE_LABEL[state.role]}</span>
        <span className={`connection connection--${state.connection}`} role="status">
          <span className="connection__dot" aria-hidden="true" />
          {CONNECTION_LABEL[state.connection]}
        </span>
        <button type="button" className="link-button topbar__action" onClick={onChangeRole}>
          Cambiar rol
        </button>
      </header>

      <main className="chat">
        <ol className="chat__messages" ref={listRef} aria-label="Mensajes">
          {state.messages.map((m) => {
            const own = m.sender === state.role;
            return (
              <li
                key={`${m.sender}:${m.messageId}`}
                className={`message ${own ? 'message--own' : 'message--other'} message--${m.status}`}
                data-seq={m.seq}
              >
                <span className="message__sender">{own ? 'Tú' : ROLE_LABEL[m.sender]}</span>
                <p className="message__text">{m.text}</p>
                {own && <span className="message__status">{STATUS_LABEL[m.status]}</span>}
              </li>
            );
          })}
        </ol>

        <form className="composer" onSubmit={submit}>
          <textarea
            aria-label="Mensaje"
            value={draft}
            rows={2}
            maxLength={MAX_TEXT_LENGTH}
            placeholder={PLACEHOLDER[state.role]}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" disabled={draft.trim().length === 0}>
            Enviar
          </button>
        </form>
      </main>
    </div>
  );
}
