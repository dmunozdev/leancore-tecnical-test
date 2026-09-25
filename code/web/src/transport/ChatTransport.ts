import type { ClientEvent, ServerEvent } from '../contract';

/**
 * Estado de la conexión visto por la interfaz.
 * - `connecting`: primer intento de conexión.
 * - `open`: conectado; ya se puede enviar.
 * - `reconnecting`: se cayó la conexión y el transporte está reintentando.
 */
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface TransportListener {
  onEvent(event: ServerEvent): void;
  onStatus(status: ConnectionStatus): void;
}

/**
 * La interfaz depende solo de esta abstracción. Implementaciones:
 * MockTransport (servidor simulado con fallas inyectables) y WebSocketTransport.
 */
export interface ChatTransport {
  /** Abre la conexión; ante una caída, el transporte reintenta por su cuenta. */
  connect(): void;
  /** Cierra la conexión de forma definitiva y deja de reintentar. */
  close(): void;
  /** Envía un evento. Devuelve false si la conexión no está abierta y el evento no salió. */
  send(event: ClientEvent): boolean;
  /** Registra un listener y devuelve la función para quitarlo. */
  subscribe(listener: TransportListener): () => void;
}
