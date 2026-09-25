# Diseño: endurecer la entrega de mensajes

## Context

La motivación está en proposal.md (Why). Estado actual y hallazgos al revisarlo:

- **Servidor:** `WsGateway` crea el `WebSocketServer` sin `maxPayload` y, por conexión, escucha `pong`, `message` y `close`, pero no `error`. Reproducido contra el gateway real: un frame de texto sin máscara (`81 02 68 69`) provoca `RangeError: Invalid WebSocket frame: MASK must be set` como `Unhandled 'error' event` y el proceso termina.
- **Qué hace `ws` cuando sí hay un listener de `error`** (sondeado con un servidor `ws` 8.21.3 aislado): ante el frame sin máscara emite `WS_ERR_EXPECTED_MASK` y cierra esa conexión con **1002**; ante un mensaje mayor a `maxPayload` emite `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH` y la cierra con **1009**. En ambos casos el servidor sigue atendiendo a otros clientes. No hace falta cerrar el socket a mano.
- **Tamaño real de un mensaje válido** (`message:send` serializado, con un UUID):

  | Texto de 2.000 caracteres | Bytes |
  |---|---|
  | Caracteres de 3 bytes en UTF-8 (por ejemplo `€`) | 6.084 |
  | Caracteres de control que JSON escapa como `\u00XX` (peor caso) | 12.084 |

  La estimación de la auditoría (unos 8 KB) se queda corta; el peor caso real es de unos 12 KB.
- **Cliente:** `chatSession` quita un pendiente de la `PendingQueue` solo con `message:ack`. Si el mensaje propio llega confirmado por `history` o `message:new`, el reducer lo marca `sent` con su `seq`, pero la cola lo conserva y lo reenvía en `queue.resume()` o en el siguiente reintento. El servidor deduplica y responde el mismo ACK, así que no hay duplicados visibles.
- **Riesgo de "no enviado" ya mitigado:** la auditoría advierte que la interfaz podría marcar "no enviado" un mensaje con `seq`. Hoy no puede pasar: el reducer ignora `local:failed` para mensajes ya confirmados (`chatReducer.ts`, caso `local:failed`), y hay una prueba de ese caso. Lo que queda es tráfico innecesario y una cola que no coincide con el estado.

## Goals / Non-Goals

**Goals:**
- Que un cliente defectuoso o malicioso solo pueda perder su propia conexión.
- Que la cola de pendientes refleje cualquier confirmación, venga del ACK, del `history` o de un `message:new`.

**Non-Goals:**
- Límites de tasa (rate limiting) o bloqueo de clientes abusivos.
- Heartbeat del lado del cliente para detectar conexiones medio abiertas (riesgo ya documentado en `add-support-chat`).
- Cambios en el contrato o en la interfaz.

## Decisions

### Decisión 1: Límite de tamaño de mensaje en el servidor

**Opciones evaluadas:** dejar el default de `ws` (100 MiB), validar el tamaño solo en la aplicación, `maxPayload` de 8 KiB y `maxPayload` de 16 KiB.

**Decisión:** `maxPayload` de **16 KiB** (16.384 bytes) en el `WebSocketServer`.

**Por qué:**
- El mensaje válido más grande pesa unos 12 KB (tabla de arriba); 16 KiB lo cubre con margen para el sobre JSON y futuros campos pequeños.
- El límite actúa en el parser de `ws`, antes de acumular el mensaje en memoria: un cliente no puede hacer que el servidor bufferice megabytes.
- El cierre con 1009 ("mensaje demasiado grande") lo da `ws` sin código propio.

**Descartadas:**
- **Default de 100 MiB:** un solo cliente puede forzar al servidor a reservar cientos de MB por conexión.
- **Validar solo en la aplicación:** cuando el handler de `message` ve el tamaño, `ws` ya bufferizó el payload completo; no protege la memoria.
- **8 KiB:** rechazaría mensajes válidos de hasta unos 12 KB (2.000 caracteres que JSON escapa).

### Decisión 2: Manejo de errores por conexión

**Opciones evaluadas:** escuchar `error` en cada socket, escuchar solo `error` en el `WebSocketServer`, y capturar `uncaughtException` en el proceso.

**Decisión:** en `onConnection`, `socket.on('error', …)` que registra el código con `console.warn` y no hace nada más; `ws` cierra la conexión (1002 o 1009) y el `close` existente la quita del registro.

**Por qué:**
- El error es de una conexión, así que se maneja en la conexión: el resto del servidor no se entera.
- `ws` ya envía el código de cierre correcto; cerrar a mano duplicaría lógica y podría ocultar el código.
- El `console.warn` deja rastro para diagnosticar clientes defectuosos sin tumbar nada.

**Descartadas:**
- **Solo `wss.on('error')`:** ese evento es del servidor (por ejemplo, un puerto ocupado); los errores de protocolo se emiten en cada `WebSocket` y seguirían sin listener.
- **`process.on('uncaughtException')`:** mantiene vivo el proceso pero en un estado desconocido, y oculta errores reales de programación.

### Decisión 3: Confirmación de pendientes por `history` y `message:new`

**Opciones evaluadas:** sacar el pendiente de la cola en `chatSession` al recibir el mensaje propio, derivar la cola del estado del reducer en cada `resume`, y dejarlo como está (el servidor deduplica).

**Decisión:** en `chatSession`, para cada mensaje de `history` y para cada `message:new` cuyo `sender` sea el rol de la sesión, llamar `queue.ack(messageId)`. En `history` se hace **antes** de `queue.resume()`, para que el reenvío ya no incluya lo confirmado.

**Por qué:**
- Es la misma operación que ya hace el ACK, en el mismo lugar donde se decide qué reenviar; son unas pocas líneas.
- Filtrar por `sender === rol` es necesario: la cola indexa por `messageId`, y un mensaje de otro remitente con el mismo `messageId` no debe confirmar el propio (decisión 4 de `add-support-chat`).

**Descartadas:**
- **Derivar la cola del estado:** mezcla el reducer (puro) con los temporizadores de la cola; es un rediseño mayor para el mismo resultado.
- **Dejarlo así:** funciona gracias a la deduplicación, pero con reenvíos innecesarios en cada reconexión y una cola que no coincide con lo que muestra la interfaz.

## Risks / Trade-offs

- **Texto válido con mucho espacio alrededor supera 16 KiB** → el servidor cierra con 1009 en lugar de aceptar el mensaje recortado. Mitigación: el front recorta el texto antes de enviarlo, así que solo afecta a clientes hechos a mano.
- **Un cliente abusivo puede reconectar y volver a enviar frames inválidos** → cada vez solo pierde su conexión y deja un `console.warn`. Mitigación: fuera de alcance (rate limiting), anotado en Non-Goals.
- **`maxPayload` solo limita lo que recibe el servidor**; un `history` grande del servidor al cliente no se ve afectado. Es lo buscado.
- **La prueba del frame sin máscara usa un socket TCP crudo con handshake manual** → depende de detalles del protocolo. Mitigación: el frame y el handshake son mínimos y estándar (RFC 6455), y la prueba verifica el efecto observable (conexión cerrada, servidor vivo), no el mensaje de error.

## Migration Plan

No hay migración de datos ni cambios de contrato. Se despliega reiniciando el servidor; los clientes reconectan solos con `resume`. Para revertir basta con volver al commit anterior.
