import { MAX_TEXT_LENGTH, type Message, type Role, type ServerEvent } from '../contract.ts';
import type { MessageNotifier, MessageRepository } from './ports.ts';

export interface SendCommand {
  conversationId: string;
  /** Rol fijado por el servidor al conectar, nunca el que declare el cliente. */
  sender: Role;
  messageId: string;
  text: string;
}

/**
 * Reglas del chat, sin dependencias de infraestructura:
 * deduplicación por remitente y `messageId`, asignación de `seq`, ACK y difusión.
 */
export class ChatService {
  private readonly repository: MessageRepository;
  private readonly notifier: MessageNotifier;

  constructor(repository: MessageRepository, notifier: MessageNotifier) {
    this.repository = repository;
    this.notifier = notifier;
  }

  /**
   * Procesa un envío y responde al emisor con `reply`.
   * Un reintento del mismo remitente recibe el mismo ACK y no se vuelve a difundir.
   */
  send(command: SendCommand, reply: (event: ServerEvent) => void): void {
    const { conversationId, sender, messageId } = command;
    const text = command.text.trim();
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
      reply({
        type: 'error',
        code: 'INVALID_TEXT',
        message: `El texto debe tener entre 1 y ${MAX_TEXT_LENGTH} caracteres`,
        messageId,
      });
      return;
    }

    const existing = this.repository.findByMessageId(conversationId, sender, messageId);
    if (existing) {
      reply(ack(existing));
      return;
    }

    const message = this.repository.append(conversationId, { messageId, sender, text });
    reply(ack(message));
    this.notifier.broadcast(conversationId, { type: 'message:new', message });
  }

  /** Mensajes posteriores a `lastSeq`, para recuperar lo perdido al reconectar. */
  resume(conversationId: string, lastSeq: number): Message[] {
    return this.repository.findAfter(conversationId, lastSeq);
  }
}

function ack(message: Message): ServerEvent {
  return { type: 'message:ack', messageId: message.messageId, seq: message.seq, serverTs: message.serverTs };
}
