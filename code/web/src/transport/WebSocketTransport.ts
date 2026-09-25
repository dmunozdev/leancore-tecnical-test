import type { ClientEvent, Role, ServerEvent } from '../contract';
import type { ChatTransport, ConnectionStatus, TransportListener } from './ChatTransport';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_JITTER_MS = 1000;

/** Espera antes del intento `attempt` (0, 1, 2…): 1 s, 2 s, 4 s… hasta 30 s, más hasta 1 s aleatorio. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) + random() * MAX_JITTER_MS;
}

/** Transporte real con el WebSocket nativo del navegador y reconexión automática. */
export class WebSocketTransport implements ChatTransport {
  private readonly url: string;
  private readonly listeners = new Set<TransportListener>();
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Intentos fallidos seguidos; vuelve a 0 al conectar. */
  private attempt = 0;
  private closed = true;

  constructor(role: Role, conversationId: string, baseUrl = defaultBaseUrl()) {
    const params = new URLSearchParams({ role, conversation: conversationId });
    this.url = `${baseUrl}/ws?${params}`;
  }

  connect(): void {
    if (!this.closed) return;
    this.closed = false;
    this.attempt = 0;
    this.open('connecting');
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  send(event: ClientEvent): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private open(status: ConnectionStatus): void {
    this.setStatus(status);
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.attempt = 0;
      this.setStatus('open');
    };

    socket.onmessage = (message) => {
      if (socket !== this.socket) return;
      let event: ServerEvent;
      try {
        event = JSON.parse(String(message.data)) as ServerEvent;
      } catch {
        console.warn('Mensaje del servidor que no es JSON; se ignora');
        return;
      }
      for (const l of this.listeners) l.onEvent(event);
    };

    // `close` llega también después de un `error`, así que la reconexión se agenda solo aquí.
    socket.onclose = () => {
      if (socket !== this.socket || this.closed) return;
      this.socket = null;
      this.setStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => this.open('reconnecting'), backoffDelay(this.attempt++));
    };
  }

  private setStatus(status: ConnectionStatus): void {
    for (const l of this.listeners) l.onStatus(status);
  }
}

/** Mismo host que la página: en desarrollo, Vite hace de proxy de `/ws` al servidor. */
function defaultBaseUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}
