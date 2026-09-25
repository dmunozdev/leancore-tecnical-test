export const ACK_TIMEOUT_MS = 5000;
export const MAX_ATTEMPTS = 3;

interface Pending {
  messageId: string;
  text: string;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Cola de mensajes propios sin ACK.
 * - Con la cola activa, cada envío espera el ACK 5 s; sin ACK, reintenta con el mismo
 *   `messageId` hasta 3 intentos y después lo da por fallido.
 * - `pause()` (conexión caída) detiene los temporizadores sin gastar intentos.
 * - `resume()` (tras recibir el historial al reconectar) reenvía todo con el contador en cero.
 */
export class PendingQueue {
  private readonly items = new Map<string, Pending>();
  private active = false;

  constructor(
    /** Envía el mensaje; devuelve false si no salió porque la conexión no está abierta. */
    private readonly transmit: (messageId: string, text: string) => boolean,
    private readonly onFailed: (messageId: string) => void,
  ) {}

  add(messageId: string, text: string): void {
    const item: Pending = { messageId, text, attempts: 0 };
    this.items.set(messageId, item);
    this.attempt(item);
  }

  ack(messageId: string): void {
    const item = this.items.get(messageId);
    if (!item) return;
    clearTimeout(item.timer);
    this.items.delete(messageId);
  }

  /** Falla definitiva (por ejemplo, un `error` del servidor con este `messageId`): sin más reintentos. */
  fail(messageId: string): void {
    const item = this.items.get(messageId);
    if (!item) return;
    clearTimeout(item.timer);
    this.items.delete(messageId);
    this.onFailed(messageId);
  }

  pause(): void {
    this.active = false;
    for (const item of this.items.values()) {
      clearTimeout(item.timer);
      item.timer = undefined;
    }
  }

  resume(): void {
    this.active = true;
    for (const item of this.items.values()) {
      clearTimeout(item.timer);
      item.attempts = 0;
      this.attempt(item);
    }
  }

  dispose(): void {
    this.pause();
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }

  private attempt(item: Pending): void {
    if (!this.active) return;
    // Si no salió, la conexión se está cayendo: el pause() llega enseguida y no se gasta el intento.
    if (!this.transmit(item.messageId, item.text)) return;
    item.attempts++;
    item.timer = setTimeout(() => {
      item.timer = undefined;
      if (!this.active) return;
      if (item.attempts >= MAX_ATTEMPTS) this.fail(item.messageId);
      else this.attempt(item);
    }, ACK_TIMEOUT_MS);
  }
}
