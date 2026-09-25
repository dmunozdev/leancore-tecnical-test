import { describe, expect, it } from 'vitest';
import type { Message, Role } from '../contract';
import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chatReducer';

function msg(seq: number, sender: Role, messageId = `${sender}-${seq}`): Message {
  return { messageId, conversationId: 'demo', seq, sender, text: `m${seq}`, serverTs: '2026-01-01T00:00:00.000Z' };
}

function reduce(state: ChatState, ...actions: ChatAction[]): ChatState {
  return actions.reduce(chatReducer, state);
}

const summary = (state: ChatState) => state.messages.map((m) => `${m.seq ?? '-'}:${m.sender}:${m.status}`);

describe('chatReducer', () => {
  const initial = initialChatState('cliente');

  it('descarta un duplicado con el mismo remitente y messageId', () => {
    const state = reduce(
      initial,
      { type: 'message:new', message: msg(1, 'agente') },
      { type: 'message:new', message: msg(1, 'agente') },
      { type: 'history', messages: [msg(1, 'agente')] },
    );
    expect(summary(state)).toEqual(['1:agente:sent']);
  });

  it('trata como distintos dos mensajes de remitentes diferentes con el mismo messageId', () => {
    const state = reduce(
      initial,
      { type: 'message:new', message: msg(1, 'cliente', 'mismo-id') },
      { type: 'message:new', message: msg(2, 'agente', 'mismo-id') },
    );
    expect(summary(state)).toEqual(['1:cliente:sent', '2:agente:sent']);
  });

  it('muestra el pendiente al final y lo reubica según su seq al llegar el ACK', () => {
    let state = reduce(
      initial,
      { type: 'local:send', messageId: 'mio', text: 'hola' },
      { type: 'message:new', message: msg(1, 'agente') },
    );
    expect(summary(state)).toEqual(['1:agente:sent', '-:cliente:pending']);

    // Llega un mensaje del agente con seq 3 antes del ACK del propio (seq 2).
    state = reduce(state, { type: 'message:new', message: msg(3, 'agente') });
    expect(summary(state)).toEqual(['1:agente:sent', '3:agente:sent', '-:cliente:pending']);

    state = reduce(state, { type: 'message:ack', messageId: 'mio', seq: 2, serverTs: '2026-01-01T00:00:01.000Z' });
    expect(summary(state)).toEqual(['1:agente:sent', '2:cliente:sent', '3:agente:sent']);
  });

  it('lastSeq es el último seq contiguo: un message:new que llega antes del history no lo avanza', () => {
    let state = reduce(initial, { type: 'history', messages: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => msg(s, 'agente')) });
    expect(state.lastSeq).toBe(8);

    state = reduce(state, { type: 'message:new', message: msg(12, 'agente') });
    expect(state.lastSeq).toBe(8);
    expect(state.messages.at(-1)?.seq).toBe(12);

    state = reduce(state, { type: 'history', messages: [9, 10, 11].map((s) => msg(s, 'agente')) });
    expect(state.lastSeq).toBe(12);
    expect(state.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('con un epoch distinto limpia los confirmados y lastSeq, pero conserva los propios sin confirmar', () => {
    let state = reduce(
      initial,
      { type: 'welcome', epoch: 'e1' },
      { type: 'history', messages: [msg(1, 'agente'), msg(2, 'cliente')] },
      { type: 'local:send', messageId: 'pendiente', text: 'sigo aquí' },
    );
    expect(state.lastSeq).toBe(2);

    state = reduce(state, { type: 'welcome', epoch: 'e1' });
    expect(summary(state)).toEqual(['1:agente:sent', '2:cliente:sent', '-:cliente:pending']);

    state = reduce(state, { type: 'welcome', epoch: 'e2' });
    expect(state.lastSeq).toBe(0);
    expect(summary(state)).toEqual(['-:cliente:pending']);
  });

  it('marca como no enviado solo un pendiente, nunca uno ya confirmado', () => {
    const state = reduce(
      initial,
      { type: 'local:send', messageId: 'a', text: 'a' },
      { type: 'local:send', messageId: 'b', text: 'b' },
      { type: 'message:ack', messageId: 'a', seq: 1, serverTs: '2026-01-01T00:00:00.000Z' },
      { type: 'local:failed', messageId: 'a' },
      { type: 'local:failed', messageId: 'b' },
    );
    expect(summary(state)).toEqual(['1:cliente:sent', '-:cliente:failed']);
  });
});
