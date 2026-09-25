// Contrato entre el cliente y el servidor.
// Fuente de verdad: sección "Contrato" de openspec/changes/add-support-chat/design.md.
// Este archivo está duplicado en code/server/src y code/web/src y debe mantenerse idéntico.

export type Role = 'cliente' | 'agente';

export const ROLES: readonly Role[] = ['cliente', 'agente'];

/** Conversación que se usa si `conversation` falta o está vacío en la URL. */
export const DEFAULT_CONVERSATION = 'demo';

/** Formato válido de `conversation`; si no lo cumple, la conexión se cierra con 1008. */
export const CONVERSATION_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Máximo de caracteres del texto, sin contar espacios al inicio y al final. */
export const MAX_TEXT_LENGTH = 2000;

/** Código de cierre cuando `role` o `conversation` de la URL son inválidos. */
export const POLICY_VIOLATION_CLOSE_CODE = 1008;

export interface Message {
  /** UUID generado por el cliente antes del primer envío; clave de idempotencia junto con `sender`. */
  messageId: string;
  conversationId: string;
  /** Asignado por el servidor, incremental por conversación. Único criterio de orden. */
  seq: number;
  /** Fijado por el servidor según la conexión, nunca por el cliente. */
  sender: Role;
  text: string;
  /** ISO 8601, solo informativo; no define el orden. */
  serverTs: string;
}

// Cliente → Servidor
export type ClientEvent =
  | { type: 'resume'; lastSeq: number }
  | { type: 'message:send'; messageId: string; text: string };

export type ErrorCode = 'INVALID_PAYLOAD' | 'INVALID_TEXT';

// Servidor → Cliente
export type ServerEvent =
  | { type: 'welcome'; epoch: string; conversationId: string; role: Role }
  | { type: 'history'; messages: Message[] }
  | { type: 'message:ack'; messageId: string; seq: number; serverTs: string }
  | { type: 'message:new'; message: Message }
  | { type: 'error'; code: ErrorCode; message: string; messageId?: string };
