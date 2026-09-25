import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CONVERSATION_ID_PATTERN,
  DEFAULT_CONVERSATION,
  POLICY_VIOLATION_CLOSE_CODE,
  ROLES,
  type ClientEvent,
  type Role,
  type ServerEvent,
} from '../contract.ts';
import type { ChatService } from '../domain/ChatService.ts';
import type { MessageNotifier } from '../domain/ports.ts';

export const HEARTBEAT_INTERVAL_MS = 30_000;

/** El mensaje válido más grande (2.000 caracteres) pesa hasta ~12 KB serializado; 16 KiB deja margen. */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Connection {
  socket: WebSocket;
  /** Fijados al conectar; el servidor no confía en lo que el cliente declare después. */
  role: Role;
  conversationId: string;
  /** Respondió el último ping. */
  alive: boolean;
}

/** Conexiones abiertas por conversación. Implementa la difusión del dominio. */
export class ConnectionRegistry implements MessageNotifier {
  private readonly byConversation = new Map<string, Set<Connection>>();

  add(connection: Connection): void {
    const set = this.byConversation.get(connection.conversationId) ?? new Set();
    set.add(connection);
    this.byConversation.set(connection.conversationId, set);
  }

  remove(connection: Connection): void {
    const set = this.byConversation.get(connection.conversationId);
    set?.delete(connection);
    if (set?.size === 0) this.byConversation.delete(connection.conversationId);
  }

  *all(): Iterable<Connection> {
    for (const set of this.byConversation.values()) yield* set;
  }

  broadcast(conversationId: string, event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const connection of this.byConversation.get(conversationId) ?? []) {
      if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(data);
    }
  }
}

export interface WsGatewayOptions {
  server: Server;
  chat: ChatService;
  registry: ConnectionRegistry;
  /** Id aleatorio de este arranque del servidor. */
  epoch: string;
  heartbeatIntervalMs?: number;
}

/** Adaptador de entrada: conexiones `ws`, validación del contrato, `epoch` y heartbeat. */
export class WsGateway {
  private readonly chat: ChatService;
  private readonly registry: ConnectionRegistry;
  private readonly epoch: string;
  private readonly wss: WebSocketServer;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(options: WsGatewayOptions) {
    this.chat = options.chat;
    this.registry = options.registry;
    this.epoch = options.epoch;
    this.wss = new WebSocketServer({ server: options.server, path: '/ws', maxPayload: MAX_PAYLOAD_BYTES });
    this.wss.on('connection', (socket, request) => this.onConnection(socket, request));
    this.heartbeat = setInterval(() => this.checkAlive(), options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const connection of this.registry.all()) connection.socket.terminate();
    this.wss.close();
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    // Un frame inválido o un payload mayor a maxPayload emite 'error' en el socket; sin este
    // listener, Node lo trata como no manejado y mata el proceso. `ws` ya cierra la conexión
    // con el código correcto (1002 o 1009); aquí solo se registra para diagnóstico.
    socket.on('error', (error) => {
      console.warn(`Conexión cerrada por error de protocolo: ${(error as NodeJS.ErrnoException).code ?? error.message}`);
    });
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const role = params.get('role');
    const conversationId = params.get('conversation') || DEFAULT_CONVERSATION;

    if (!ROLES.includes(role as Role)) {
      socket.close(POLICY_VIOLATION_CLOSE_CODE, 'role inválido');
      return;
    }
    if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
      socket.close(POLICY_VIOLATION_CLOSE_CODE, 'conversation inválida');
      return;
    }

    const connection: Connection = { socket, role: role as Role, conversationId, alive: true };
    this.registry.add(connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, isBinary) => this.onMessage(connection, data, isBinary));
    socket.on('close', () => this.registry.remove(connection));

    send(connection, { type: 'welcome', epoch: this.epoch, conversationId, role: connection.role });
  }

  private onMessage(connection: Connection, data: RawData, isBinary: boolean): void {
    const parsed = isBinary ? invalid('Se esperaba texto JSON') : parseClientEvent(data.toString());
    if (!parsed.ok) {
      send(connection, { type: 'error', code: 'INVALID_PAYLOAD', message: parsed.reason, messageId: parsed.messageId });
      return;
    }

    const event = parsed.event;
    switch (event.type) {
      case 'resume':
        send(connection, { type: 'history', messages: this.chat.resume(connection.conversationId, event.lastSeq) });
        break;
      case 'message:send':
        this.chat.send(
          { conversationId: connection.conversationId, sender: connection.role, messageId: event.messageId, text: event.text },
          (reply) => send(connection, reply),
        );
        break;
    }
  }

  /** Cierra las conexiones que no respondieron el ping anterior y vuelve a hacer ping al resto. */
  private checkAlive(): void {
    for (const connection of this.registry.all()) {
      if (!connection.alive) {
        this.registry.remove(connection);
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }
}

function send(connection: Connection, event: ServerEvent): void {
  if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify(event));
}

type ParseResult = { ok: true; event: ClientEvent } | { ok: false; reason: string; messageId?: string };

const invalid = (reason: string, messageId?: string): ParseResult => ({ ok: false, reason, messageId });

/**
 * Valida un evento del cliente contra el contrato. Exige los campos requeridos e ignora
 * los adicionales: un `sender` declarado por el cliente no se rechaza, simplemente no se usa.
 */
export function parseClientEvent(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('JSON inválido');
  }
  if (typeof value !== 'object' || value === null) return invalid('Se esperaba un objeto');
  const event = value as Record<string, unknown>;

  switch (event.type) {
    case 'resume': {
      const { lastSeq } = event;
      if (typeof lastSeq !== 'number' || !Number.isInteger(lastSeq) || lastSeq < 0) {
        return invalid('lastSeq debe ser un entero mayor o igual a 0');
      }
      return { ok: true, event: { type: 'resume', lastSeq } };
    }
    case 'message:send': {
      const { messageId, text } = event;
      if (typeof messageId !== 'string' || !UUID_PATTERN.test(messageId)) return invalid('messageId debe ser un UUID');
      if (typeof text !== 'string') return invalid('text debe ser un string', messageId);
      return { ok: true, event: { type: 'message:send', messageId, text } };
    }
    default:
      return invalid('Tipo de evento desconocido');
  }
}
