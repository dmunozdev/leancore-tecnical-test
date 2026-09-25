import { beforeEach, describe, expect, it } from 'vitest';
import type { Message, ServerEvent } from '../contract.ts';
import { InMemoryMessageRepository } from '../adapters/InMemoryMessageRepository.ts';
import { ChatService } from './ChatService.ts';
import type { MessageNotifier } from './ports.ts';

class RecordingNotifier implements MessageNotifier {
  readonly broadcasts: { conversationId: string; event: ServerEvent }[] = [];
  broadcast(conversationId: string, event: ServerEvent): void {
    this.broadcasts.push({ conversationId, event });
  }
}

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

describe('ChatService', () => {
  let repository: InMemoryMessageRepository;
  let notifier: RecordingNotifier;
  let chat: ChatService;

  beforeEach(() => {
    repository = new InMemoryMessageRepository();
    notifier = new RecordingNotifier();
    chat = new ChatService(repository, notifier);
  });

  /** Envía y devuelve lo que se le respondió al emisor. */
  function send(sender: 'cliente' | 'agente', messageId: string, text: string, conversationId = 'demo'): ServerEvent[] {
    const replies: ServerEvent[] = [];
    chat.send({ conversationId, sender, messageId, text }, (e) => replies.push(e));
    return replies;
  }

  const seqOf = (events: ServerEvent[]) => (events[0]?.type === 'message:ack' ? events[0].seq : undefined);

  it('asigna un seq creciente por conversación', () => {
    expect(seqOf(send('cliente', ID_1, 'uno'))).toBe(1);
    expect(seqOf(send('agente', ID_2, 'dos'))).toBe(2);
    expect(seqOf(send('cliente', ID_3, 'tres'))).toBe(3);
    // Otra conversación tiene su propia secuencia.
    expect(seqOf(send('cliente', ID_1, 'otra', 'otra'))).toBe(1);
  });

  it('un messageId repetido del mismo remitente devuelve el mismo seq, sin guardar ni difundir de nuevo', () => {
    const first = send('cliente', ID_1, 'hola');
    const retry = send('cliente', ID_1, 'hola');

    expect(retry).toEqual(first);
    expect(repository.findAfter('demo', 0)).toHaveLength(1);
    expect(notifier.broadcasts).toHaveLength(1);
  });

  it('el mismo messageId de otro remitente recibe un seq nuevo', () => {
    send('cliente', ID_1, 'del cliente');
    const fromAgent = send('agente', ID_1, 'del agente');

    expect(seqOf(fromAgent)).toBe(2);
    expect(repository.findAfter('demo', 0).map((m) => m.sender)).toEqual(['cliente', 'agente']);
    expect(notifier.broadcasts).toHaveLength(2);
  });

  it('findAfter devuelve solo lo posterior a lastSeq, en orden', () => {
    send('cliente', ID_1, 'uno');
    send('agente', ID_2, 'dos');
    send('cliente', ID_3, 'tres');

    const seqs = (messages: Message[]) => messages.map((m) => m.seq);
    expect(seqs(chat.resume('demo', 0))).toEqual([1, 2, 3]);
    expect(seqs(chat.resume('demo', 1))).toEqual([2, 3]);
    expect(seqs(chat.resume('demo', 3))).toEqual([]);
    expect(seqs(chat.resume('otra', 0))).toEqual([]);
  });

  it('responde el ACK al emisor y difunde message:new a la conversación', () => {
    const replies = send('cliente', ID_1, '  hola  ');

    expect(replies).toEqual([expect.objectContaining({ type: 'message:ack', messageId: ID_1, seq: 1 })]);
    expect(notifier.broadcasts).toEqual([
      {
        conversationId: 'demo',
        event: { type: 'message:new', message: expect.objectContaining({ seq: 1, sender: 'cliente', text: 'hola' }) },
      },
    ]);
  });

  it.each([
    ['vacío', '   '],
    ['de más de 2.000 caracteres', 'x'.repeat(2001)],
  ])('rechaza un texto %s con INVALID_TEXT y el messageId, sin guardarlo', (_, text) => {
    const replies = send('cliente', ID_1, text);

    expect(replies).toEqual([expect.objectContaining({ type: 'error', code: 'INVALID_TEXT', messageId: ID_1 })]);
    expect(repository.findAfter('demo', 0)).toEqual([]);
    expect(notifier.broadcasts).toEqual([]);
  });

  it('acepta 2.000 caracteres sin contar los espacios al inicio y al final', () => {
    expect(seqOf(send('cliente', ID_1, `  ${'x'.repeat(2000)}  `))).toBe(1);
  });
});
