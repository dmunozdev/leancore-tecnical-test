import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientEvent, Role } from '../contract';
import { MockTransport } from '../transport/MockTransport';
import { chatReducer, initialChatState, type ChatState } from './chatReducer';
import { startChatSession } from './chatSession';
import { PendingQueue } from './pendingQueue';

/** Sesión real sobre el MockTransport, con el reducer como store. */
function setup(role: Role = 'cliente') {
  const transport = new MockTransport(role, 'demo');
  let state: ChatState = initialChatState(role);
  const session = startChatSession(transport, (action) => (state = chatReducer(state, action)), () => state);
  const sentMessages = () =>
    sendSpy.mock.calls.map(([e]) => e as ClientEvent).filter((e) => e.type === 'message:send');
  const sendSpy = vi.spyOn(transport, 'send');
  return {
    transport,
    session,
    sentMessages,
    get state() {
      return state;
    },
  };
}

const texts = (state: ChatState) => state.messages.map((m) => `${m.seq ?? '-'}:${m.text}:${m.status}`);

describe('sesión de chat con MockTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('con duplicados y desorden inyectados, muestra cada mensaje una vez y ordenado por seq', async () => {
    const chat = setup();
    await vi.advanceTimersByTimeAsync(1000);
    chat.transport.faults.duplicate = true;
    chat.transport.faults.reorder = true;

    chat.transport.receiveFromOther('uno');
    chat.transport.receiveFromOther('dos');
    chat.session.send('mío');
    chat.transport.receiveFromOther('tres');
    await vi.advanceTimersByTimeAsync(2000);

    expect(texts(chat.state)).toEqual(['1:uno:sent', '2:dos:sent', '3:tres:sent', '4:mío:sent']);
    expect(chat.state.lastSeq).toBe(4);
  });

  it('reubica el pendiente propio cuando el otro participante escribe primero', async () => {
    const chat = setup();
    await vi.advanceTimersByTimeAsync(1000);

    chat.session.send('mío');
    chat.transport.receiveFromOther('del agente'); // llega al servidor antes que el propio
    expect(texts(chat.state)).toEqual(['-:mío:pending']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(texts(chat.state)).toEqual(['1:del agente:sent', '2:mío:sent']);
  });

  it('no gasta intentos mientras la conexión está caída y reenvía al reconectar', async () => {
    const chat = setup();
    await vi.advanceTimersByTimeAsync(1000);

    chat.transport.dropConnection(20_000);
    chat.session.send('sin red');
    chat.transport.receiveFromOther('escrito durante la caída');

    await vi.advanceTimersByTimeAsync(18_000);
    expect(chat.state.connection).toBe('reconnecting');
    expect(texts(chat.state)).toEqual(['-:sin red:pending']);
    expect(chat.sentMessages()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3000);
    expect(chat.state.connection).toBe('open');
    // Primero se recupera lo que faltó (resume) y después sale el pendiente.
    expect(texts(chat.state)).toEqual(['1:escrito durante la caída:sent', '2:sin red:sent']);
    expect(chat.sentMessages()).toHaveLength(1);
  });

  it('con la conexión abierta y sin ACK, reintenta con el mismo messageId y a los 3 intentos lo marca no enviado', async () => {
    const chat = setup();
    await vi.advanceTimersByTimeAsync(1000);
    // El servidor simulado se traga los envíos: no hay ACK ni message:new.
    const original = chat.transport.send.bind(chat.transport);
    chat.transport.send = vi.fn((e: ClientEvent) => (e.type === 'message:send' ? true : original(e)));

    chat.session.send('nunca llega');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(texts(chat.state)).toEqual(['-:nunca llega:pending']);

    await vi.advanceTimersByTimeAsync(1);
    expect(texts(chat.state)).toEqual(['-:nunca llega:failed']);
    const sends = vi.mocked(chat.transport.send).mock.calls.map(([e]) => e).filter((e) => e.type === 'message:send');
    expect(sends).toHaveLength(3);
    expect(new Set(sends.map((e) => (e.type === 'message:send' ? e.messageId : '')))).toHaveProperty('size', 1);
  });

  it('con ACKs perdidos, el reintento no duplica el mensaje', async () => {
    const chat = setup();
    await vi.advanceTimersByTimeAsync(1000);
    chat.transport.faults.dropAcks = true;

    chat.session.send('ACK perdido');
    await vi.advanceTimersByTimeAsync(6000); // pasa un reintento

    expect(chat.sentMessages().length).toBeGreaterThanOrEqual(2);
    expect(chat.transport.server.findAfter('demo', 0)).toHaveLength(1);
    expect(texts(chat.state)).toEqual(['1:ACK perdido:sent']);
  });

  it('tras un reinicio del servidor limpia el historial y reenvía los pendientes al servidor nuevo', async () => {
    const chat = setup();
    await vi.advanceTimersByTimeAsync(1000);
    chat.session.send('antes del reinicio');
    await vi.advanceTimersByTimeAsync(1000);

    chat.transport.restartServer();
    chat.session.send('durante el reinicio');
    await vi.advanceTimersByTimeAsync(3000);

    expect(texts(chat.state)).toEqual(['1:durante el reinicio:sent']);
    expect(chat.state.lastSeq).toBe(1);
  });
});

describe('PendingQueue', () => {
  it('un error del servidor con el messageId lo marca no enviado de inmediato, sin más reintentos', () => {
    vi.useFakeTimers();
    const transmit = vi.fn(() => true);
    const onFailed = vi.fn();
    const queue = new PendingQueue(transmit, onFailed);
    queue.resume();
    queue.add('m1', 'hola');

    queue.fail('m1');
    vi.advanceTimersByTime(20_000);

    expect(onFailed).toHaveBeenCalledWith('m1');
    expect(transmit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
