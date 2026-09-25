import type { Message, Role, ServerEvent } from '../contract.ts';

export interface MessageDraft {
  messageId: string;
  sender: Role;
  text: string;
}

/**
 * Persistencia de mensajes. Es síncrona a propósito: con el adaptador en memoria,
 * revisar si el mensaje existe y guardarlo ocurre sin interrupciones (decisión 6).
 * En producción, la unicidad la garantiza la escritura condicional de la base de datos.
 */
export interface MessageRepository {
  /** Guarda el mensaje y le asigna el siguiente `seq` de la conversación de forma atómica. */
  append(conversationId: string, draft: MessageDraft): Message;
  findByMessageId(conversationId: string, sender: Role, messageId: string): Message | undefined;
  /** Mensajes con `seq` mayor a `lastSeq`, en orden. */
  findAfter(conversationId: string, lastSeq: number): Message[];
}

/** Difusión a los participantes de una conversación. Con `ws` recorre las conexiones; en AWS sería `postToConnection`. */
export interface MessageNotifier {
  broadcast(conversationId: string, event: ServerEvent): void;
}
