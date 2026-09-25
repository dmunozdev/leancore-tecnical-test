# Propuesta: endurecer la entrega de mensajes

## Why

Una auditoría del cambio archivado `add-support-chat` encontró dos problemas en la entrega de mensajes:

1. **Un solo cliente defectuoso tumba el servidor para todos.** Si una conexión envía un frame que `ws` no puede parsear (por ejemplo, un frame sin máscara), `ws` emite `error` en el socket; nadie lo escucha y el proceso muere con `Unhandled 'error' event` (`WS_ERR_EXPECTED_MASK`). Se reprodujo contra el `WsGateway` real: después de un frame de 4 bytes, el servidor deja de responder. Además, el `WebSocketServer` no fija `maxPayload`, así que acepta hasta el default de `ws` (100 MiB) cuando el mensaje válido más grande pesa unos 12 KB.
2. **El cliente reenvía pendientes que ya llegaron.** Si un mensaje propio aparece en el `history` o en un `message:new` sin que haya llegado su ACK (por ejemplo, el ACK se perdió en la caída), el reducer lo marca como enviado, pero la cola de pendientes no se entera y lo reenvía al hacer `resume`. El servidor lo deduplica, así que no se duplica, pero es tráfico de más y la cola queda inconsistente con lo que muestra la interfaz.

El primero es un problema de disponibilidad del chat completo; el segundo, de coherencia del cliente. Ambos son chicos y se resuelven sin cambiar el contrato.

## What Changes

- **Servidor:** el `WsGateway` escucha el evento `error` de cada conexión, lo registra y deja que `ws` cierre solo esa conexión. El `WebSocketServer` fija `maxPayload` en 16 KiB; un mensaje más grande cierra esa conexión con el código 1009.
- **Cliente:** cuando un mensaje propio llega confirmado por `history` o `message:new`, la sesión lo quita de la cola de pendientes antes de reenviar, igual que si hubiera llegado su ACK.
- **Pruebas:** integración del gateway con un frame sin máscara enviado por un socket crudo y con un payload de 17 KiB; pruebas de la sesión con un pendiente que llega en el `history` y en un `message:new`.
- Sin cambios en el contrato (`contract.ts`) ni en la interfaz. **No hay cambios incompatibles.**

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `message-delivery`: se agrega el requisito "Tolerancia a clientes defectuosos" y se modifica "Recuperación tras una reconexión" para que un pendiente que ya llegó confirmado no se reenvíe.

## Impact

- **Código:** `code/server/src/adapters/WsGateway.ts` y `code/web/src/state/chatSession.ts`.
- **Pruebas:** `code/server/src/adapters/WsGateway.test.ts` y `code/web/src/state/chatSession.test.ts`.
- **Dependencias:** ninguna nueva; `maxPayload` y el evento `error` son parte de `ws`.
- **Comportamiento visible:** un cliente que envía un frame inválido o de más de 16 KiB pierde su conexión (y el `WebSocketTransport` reconecta solo); el resto de las conexiones no se entera. El front real no se ve afectado: recorta el texto y respeta el límite de 2.000 caracteres antes de enviar.
