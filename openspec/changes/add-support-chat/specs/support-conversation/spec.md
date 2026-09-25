# Conversación de soporte

Quiénes participan en una conversación, cómo entran y qué reglas cumplen los mensajes que intercambian.

## ADDED Requirements

### Requirement: Selección de rol al entrar

El sistema DEBE (MUST) permitir que cada participante elija su rol al entrar a la aplicación y DEBE (MUST) enviar ese rol al conectar.

#### Scenario: Entrada desde la pantalla inicial

- **WHEN** alguien abre la aplicación sin un rol definido
- **THEN** ve dos opciones: "Entrar como cliente" y "Entrar como agente"
- **AND** al elegir una, se conecta con ese rol a la conversación `demo`

#### Scenario: Entrada directa por URL

- **WHEN** alguien abre la aplicación con `?role=agente`
- **THEN** entra directamente al chat como agente, sin pasar por la pantalla inicial

### Requirement: Intercambio de mensajes en tiempo real

El sistema DEBE (MUST) permitir que un cliente y un agente de la misma conversación intercambien mensajes y los vean aparecer sin recargar la página.

#### Scenario: El cliente envía un mensaje

- **WHEN** el cliente envía un mensaje en la conversación `demo`
- **THEN** el agente conectado a `demo` lo recibe con el evento `message:new`
- **AND** el cliente lo ve en su propia lista

#### Scenario: Conversaciones distintas no se mezclan

- **WHEN** un cliente envía un mensaje en la conversación `a`
- **THEN** los participantes de la conversación `b` no lo reciben

### Requirement: Remitente fijado por el servidor

El servidor DEBE (MUST) fijar el rol y la conversación de cada participante al momento de conectar, e ignorar cualquier remitente declarado en los mensajes.

#### Scenario: Conexión con parámetros inválidos

- **WHEN** alguien se conecta con un `role` distinto de `cliente` o `agente`
- **THEN** el servidor cierra la conexión con el código 1008

#### Scenario: Remitente de un mensaje

- **WHEN** una conexión con rol `cliente` envía un mensaje
- **THEN** el mensaje se guarda y se difunde con `sender: 'cliente'`

### Requirement: Visualización de mensajes propios

El cliente DEBE (MUST) mostrar como propios los mensajes cuyo `sender` coincide con el rol de la sesión, sin depender de qué pestaña los envió.

#### Scenario: Mensajes propios en varias pestañas

- **WHEN** dos pestañas con el mismo rol están en la conversación
- **THEN** ambas muestran como propios los mensajes cuyo `sender` coincide con su rol
- **AND** se siguen viendo como propios tras recargar y recuperar con `resume(0)`

### Requirement: Validación de mensajes

El servidor DEBE (MUST) rechazar los eventos que no cumplen el contrato.

#### Scenario: Texto inválido

- **WHEN** llega un `message:send` con el texto vacío o de más de 2.000 caracteres
- **THEN** el servidor responde `error` con el código `INVALID_TEXT` y no guarda el mensaje

#### Scenario: Evento mal formado

- **WHEN** llega un evento que no cumple el contrato
- **THEN** el servidor responde `error` con el código `INVALID_PAYLOAD` y no lo procesa
