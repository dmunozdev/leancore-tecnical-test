import type { Message, Role } from '../contract.ts';
import type { MessageDraft, MessageRepository } from '../domain/ports.ts';

/** Mensajes en memoria, por conversación. El `seq` es la posición en la lista más uno. */
export class InMemoryMessageRepository implements MessageRepository {
  private readonly conversations = new Map<string, Message[]>();

  append(conversationId: string, draft: MessageDraft): Message {
    const messages = this.conversations.get(conversationId) ?? [];
    this.conversations.set(conversationId, messages);
    const message: Message = {
      ...draft,
      conversationId,
      seq: messages.length + 1,
      serverTs: new Date().toISOString(),
    };
    messages.push(message);
    return message;
  }

  findByMessageId(conversationId: string, sender: Role, messageId: string): Message | undefined {
    return this.conversations.get(conversationId)?.find((m) => m.sender === sender && m.messageId === messageId);
  }

  findAfter(conversationId: string, lastSeq: number): Message[] {
    // Como seq = índice + 1, lo posterior a lastSeq empieza en el índice lastSeq.
    return (this.conversations.get(conversationId) ?? []).slice(Math.max(0, lastSeq));
  }
}
