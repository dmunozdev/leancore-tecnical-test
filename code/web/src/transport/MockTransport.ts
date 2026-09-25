import {
  MAX_TEXT_LENGTH,
  type ClientEvent,
  type Message,
  type Role,
  type ServerEvent,
} from '../contract';
import type { ChatTransport, ConnectionStatus, TransportListener } from './ChatTransport';

/** Fallas que se pueden activar para probar la interfaz sin el servidor real. */
export interface MockFaults {
  /** Entrega dos veces cada `message:ack` y `message:new`. */
  duplicate: boolean;
  /** Acumula los `message:new` durante un instante y los entrega en orden inverso. */
  reorder: boolean;
  /** No entrega los `message:ack`, para forzar los reintentos del cliente. */
  dropAcks: boolean;
}

const REORDER_WINDOW_MS = 400;

/**
 * Servidor simulado en memoria con las mismas reglas del contrato:
 * `seq` por conversación, deduplicación por remitente y `messageId`, y `epoch` por arranque.
 */
export class MockServer {
  epoch = crypto.randomUUID();
  private readonly conversations = new Map<string, Message[]>();

  restart(): void {
    this.epoch = crypto.randomUUID();
    this.conversations.clear();
  }

  append(conversationId: string, sender: Role, messageId: string, text: string): { message: Message; isNew: boolean } {
    const messages = this.conversations.get(conversationId) ?? [];
    this.conversations.set(conversationId, messages);
    const existing = messages.find((m) => m.sender === sender && m.messageId === messageId);
    if (existing) return { message: existing, isNew: false };
    const message: Message = {
      messageId,
      conversationId,
      seq: messages.length + 1,
      sender,
      text,
      serverTs: new Date().toISOString(),
    };
    messages.push(message);
    return { message, isNew: true };
  }

  findAfter(conversationId: string, lastSeq: number): Message[] {
    return (this.conversations.get(conversationId) ?? []).filter((m) => m.seq > lastSeq);
  }
}

/**
 * Transporte simulado: responde como el servidor, con latencia, y permite inyectar
 * duplicados, desorden, ACKs perdidos, desconexiones y reinicios del servidor.
 */
export class MockTransport implements ChatTransport {
  readonly faults: MockFaults = { duplicate: false, reorder: false, dropAcks: false };

  private readonly listeners = new Set<TransportListener>();
  private status: ConnectionStatus | 'closed' = 'closed';
  /** Cambia en cada conexión; lo que estaba en vuelo en una conexión anterior se descarta. */
  private connectionId = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reorderBuffer: ServerEvent[] = [];
  private reorderTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly role: Role,
    private readonly conversationId: string,
    readonly server: MockServer = new MockServer(),
    private readonly latencyMs = 150,
  ) {}

  connect(): void {
    if (this.status !== 'closed') return;
    this.open('connecting');
  }

  close(): void {
    this.discardInFlight();
    this.status = 'closed';
  }

  send(event: ClientEvent): boolean {
    if (this.status !== 'open') return false;
    const id = this.connectionId;
    setTimeout(() => {
      if (id === this.connectionId) this.handle(event);
    }, this.latencyMs);
    return true;
  }

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Controles para simular fallas ---

  /** Corta la conexión y reconecta sola después de `reconnectAfterMs`. */
  dropConnection(reconnectAfterMs = 2000): void {
    if (this.status === 'closed') return;
    this.discardInFlight();
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.open('reconnecting'), reconnectAfterMs);
  }

  /** Reinicia el servidor: nuevo `epoch`, historial vacío y reconexión de los clientes. */
  restartServer(): void {
    this.server.restart();
    this.dropConnection(1000);
  }

  /** Simula un mensaje del otro participante. Si la conexión está caída, se recupera con `resume`. */
  receiveFromOther(text: string): void {
    const other: Role = this.role === 'cliente' ? 'agente' : 'cliente';
    const { message } = this.server.append(this.conversationId, other, crypto.randomUUID(), text);
    if (this.status === 'open') this.deliver({ type: 'message:new', message });
  }

  // --- Internos ---

  /** Invalida la conexión actual: lo que estaba en vuelo ya no se entrega. */
  private discardInFlight(): void {
    this.connectionId++;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.reorderTimer);
    this.reorderTimer = undefined;
    this.reorderBuffer = [];
  }

  private open(phase: ConnectionStatus): void {
    this.setStatus(phase);
    const id = ++this.connectionId;
    setTimeout(() => {
      if (id !== this.connectionId) return;
      this.setStatus('open');
      this.emit({ type: 'welcome', epoch: this.server.epoch, conversationId: this.conversationId, role: this.role });
    }, this.latencyMs);
  }

  private handle(event: ClientEvent): void {
    if (event.type === 'resume') {
      this.deliver({ type: 'history', messages: this.server.findAfter(this.conversationId, event.lastSeq) });
      return;
    }
    const text = event.text.trim();
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
      this.deliver({ type: 'error', code: 'INVALID_TEXT', message: 'Texto vacío o demasiado largo', messageId: event.messageId });
      return;
    }
    const { message, isNew } = this.server.append(this.conversationId, this.role, event.messageId, text);
    this.deliver({ type: 'message:ack', messageId: message.messageId, seq: message.seq, serverTs: message.serverTs });
    if (isNew) this.deliver({ type: 'message:new', message });
  }

  private deliver(event: ServerEvent): void {
    if (event.type === 'message:ack' && this.faults.dropAcks) return;
    const id = this.connectionId;
    setTimeout(() => {
      if (id !== this.connectionId) return;
      if (event.type === 'message:new' && this.faults.reorder) {
        this.bufferForReorder(event);
        return;
      }
      this.emit(event);
      if (this.faults.duplicate && (event.type === 'message:ack' || event.type === 'message:new')) this.emit(event);
    }, this.latencyMs);
  }

  private bufferForReorder(event: ServerEvent): void {
    this.reorderBuffer.push(event);
    if (this.reorderTimer !== undefined) return;
    this.reorderTimer = setTimeout(() => {
      const batch = this.reorderBuffer.reverse();
      this.reorderBuffer = [];
      this.reorderTimer = undefined;
      for (const e of batch) {
        this.emit(e);
        if (this.faults.duplicate) this.emit(e);
      }
    }, REORDER_WINDOW_MS);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const l of this.listeners) l.onStatus(status);
  }

  private emit(event: ServerEvent): void {
    for (const l of this.listeners) l.onEvent(event);
  }
}
