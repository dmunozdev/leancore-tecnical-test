## ADDED Requirements

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

## MODIFIED Requirements

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
