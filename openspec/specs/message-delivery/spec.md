# message-delivery Specification

## Purpose
Cómo se garantiza que los mensajes entre el cliente y el agente no se pierdan, no se dupliquen y lleguen en el mismo orden a ambos participantes, incluso con desconexiones, reintentos y reinicios del servidor.

## Requirements

### Requirement: Confirmación de recepción

El servidor DEBE (MUST) responder al emisor con un `message:ack` que incluya el `messageId` y el `seq` asignado a cada mensaje aceptado.

#### Scenario: Mensaje confirmado

- **WHEN** el servidor acepta un mensaje
- **THEN** responde al emisor con `message:ack` y el `seq` asignado
- **AND** el cliente cambia el mensaje de "enviando" a "enviado"

#### Scenario: ACK que no llega

- **WHEN** el cliente no recibe el ACK en 5 segundos
- **THEN** reenvía el mensaje con el mismo `messageId`

#### Scenario: Intentos agotados

- **WHEN** un mensaje supera 3 intentos sin ACK con la conexión abierta
- **THEN** el cliente lo muestra como "no enviado"

#### Scenario: Caída con mensajes enviando

- **WHEN** se cae la conexión con un mensaje "enviando"
- **THEN** el mensaje sigue "enviando" sin consumir intentos
- **AND** al reconectar se reenvía con el contador de intentos en cero

### Requirement: Deduplicación por remitente y messageId

El servidor DEBE (MUST) tratar como el mismo mensaje cualquier envío repetido con el mismo `messageId` del mismo remitente dentro de una conversación, y DEBE (MUST) tratar como distintos los mensajes de remitentes diferentes aunque compartan `messageId`.

#### Scenario: Reintento de un mensaje ya guardado

- **WHEN** llega un `message:send` con un `messageId` que el mismo remitente ya usó en la conversación
- **THEN** el servidor no lo guarda de nuevo
- **AND** responde un ACK con el mismo `seq` que asignó la primera vez
- **AND** no vuelve a difundirlo

#### Scenario: Mismo messageId de otro remitente

- **WHEN** el agente envía un `messageId` que ya usó el cliente en la conversación
- **THEN** el servidor lo guarda como un mensaje nuevo con su propio `seq`
- **AND** responde el ACK con ese `seq`, no con el del cliente

#### Scenario: Duplicado recibido por el cliente

- **WHEN** el cliente recibe un mensaje con el mismo remitente y `messageId` que uno que ya tiene en pantalla
- **THEN** actualiza ese mensaje en lugar de agregar uno nuevo

### Requirement: Orden por secuencia del servidor

El servidor DEBE (MUST) asignar a cada mensaje aceptado un `seq` incremental por conversación, y los clientes DEBEN (MUST) mostrar los mensajes confirmados ordenados por `seq`.

#### Scenario: Mensajes casi simultáneos

- **WHEN** el cliente y el agente envían un mensaje casi al mismo tiempo
- **THEN** el servidor asigna el `seq` menor al que llega primero
- **AND** ambos participantes ven los dos mensajes en el mismo orden

#### Scenario: Pendiente reubicado

- **WHEN** un mensaje propio en estado "enviando" recibe su ACK
- **THEN** el cliente lo ubica en la posición que le corresponde según su `seq`

### Requirement: Recuperación tras una reconexión

El sistema DEBE (MUST) entregar a un cliente que se reconecta todos los mensajes posteriores a su `lastSeq`, y el cliente DEBE (MUST) reenviar sus pendientes, salvo los que ya le llegaron confirmados por el servidor.

#### Scenario: El receptor se reconecta

- **WHEN** un cliente con `lastSeq: 8` se reconecta y envía `resume` con `lastSeq: 8`
- **THEN** el servidor le envía en `history` los mensajes con `seq` mayor a 8, en orden

#### Scenario: Mensaje nuevo antes del historial

- **WHEN** tras reconectar llega un `message:new` con `seq` 12 antes del `history` con los `seq` 9 a 11
- **THEN** el cliente lo muestra ubicado por `seq`
- **AND** `lastSeq` no avanza a 12 hasta que el `history` llena el hueco

#### Scenario: El emisor se reconecta con pendientes

- **WHEN** un cliente se reconecta con mensajes sin confirmar
- **THEN** los reenvía con el mismo `messageId` después de recibir el `history`

#### Scenario: Pendiente que ya llegó en el history

- **WHEN** un cliente se reconecta con un pendiente cuyo `messageId` viene en el `history` con su mismo remitente
- **THEN** lo marca como enviado con ese `seq`
- **AND** no lo reenvía

#### Scenario: Pendiente confirmado por un message:new

- **WHEN** llega un `message:new` con un mensaje propio que todavía estaba pendiente porque su ACK no llegó
- **THEN** el cliente lo marca como enviado con ese `seq`
- **AND** no lo reenvía en los reintentos ni al reconectar

#### Scenario: Reintento de conexión

- **WHEN** se cae la conexión
- **THEN** el cliente muestra "Reconectando…"
- **AND** reintenta con espera exponencial, desde 1 s hasta un máximo de 30 s, más un tiempo aleatorio

### Requirement: Detección del reinicio del servidor

El servidor DEBE (MUST) enviar al conectar un `epoch` generado al iniciar, y el cliente DEBE (MUST) reiniciar su estado cuando el `epoch` cambia.

#### Scenario: El servidor se reinició

- **WHEN** el cliente se reconecta y recibe un `epoch` distinto al que tenía
- **THEN** reinicia su `lastSeq` a 0 y limpia la lista de mensajes confirmados
- **AND** conserva sus pendientes y los reenvía

### Requirement: Detección de conexiones muertas

El servidor DEBE (MUST) detectar y cerrar las conexiones que dejan de responder.

#### Scenario: Conexión medio abierta

- **WHEN** una conexión no responde el *ping* del servidor antes del siguiente ciclo de 30 segundos
- **THEN** el servidor la cierra y deja de enviarle mensajes

### Requirement: Tolerancia a clientes defectuosos

El servidor DEBE (MUST) seguir atendiendo a las demás conexiones cuando una conexión envía un frame inválido o un mensaje que supera el límite de 16 KiB, y DEBE (MUST) cerrar únicamente la conexión que lo envió.

#### Scenario: Frame mal formado

- **WHEN** una conexión envía un frame que no cumple el protocolo WebSocket (por ejemplo, un frame de cliente sin máscara)
- **THEN** el servidor cierra solo esa conexión
- **AND** sigue aceptando conexiones nuevas y entregando mensajes a las demás

#### Scenario: Mensaje mayor al límite

- **WHEN** una conexión envía un mensaje de más de 16 KiB
- **THEN** el servidor cierra esa conexión con el código 1009
- **AND** sigue aceptando conexiones nuevas y entregando mensajes a las demás
