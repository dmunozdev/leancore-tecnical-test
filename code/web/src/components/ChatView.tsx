import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_TEXT_LENGTH, type Role } from '../contract';
import type { ChatState, LocalStatus } from '../state/chatReducer';

const STATUS_LABEL: Record<LocalStatus, string> = {
  pending: 'enviando',
  sent: 'enviado',
  failed: 'no enviado',
};

const ROLE_LABEL: Record<Role, string> = { cliente: 'Cliente', agente: 'Agente' };

interface Props {
  conversationId: string;
  state: ChatState;
  onSend: (text: string) => boolean;
}

export function ChatView({ conversationId, state, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [state.messages.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onSend(draft)) setDraft('');
  };

  return (
    <main className="chat">
      <header className="chat__header">
        <span>
          {ROLE_LABEL[state.role]} · conversación <strong>{conversationId}</strong>
        </span>
      </header>

      {state.connection !== 'open' && (
        <div className="chat__banner" role="status">
          {state.connection === 'reconnecting' ? 'Reconectando…' : 'Conectando…'}
        </div>
      )}

      <ol className="chat__messages" ref={listRef} aria-label="Mensajes">
        {state.messages.map((m) => {
          const own = m.sender === state.role;
          return (
            <li
              key={`${m.sender}:${m.messageId}`}
              className={`message ${own ? 'message--own' : 'message--other'} message--${m.status}`}
              data-seq={m.seq}
            >
              <span className="message__sender">{ROLE_LABEL[m.sender]}</span>
              <p className="message__text">{m.text}</p>
              {own && <span className="message__status">{STATUS_LABEL[m.status]}</span>}
            </li>
          );
        })}
      </ol>

      <form className="chat__composer" onSubmit={submit}>
        <input
          aria-label="Mensaje"
          value={draft}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="Escribe un mensaje"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={draft.trim().length === 0}>
          Enviar
        </button>
      </form>
    </main>
  );
}
