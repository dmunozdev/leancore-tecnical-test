# Chat de soporte en tiempo real

Prueba técnica para LeanCore: un chat mínimo entre un **cliente** y un **agente** de soporte. El foco no es la interfaz sino el problema clásico del tiempo real:

- que **ningún mensaje se pierda** aunque se caiga la conexión,
- que un reintento **no se convierta en un duplicado**,
- y que **ambos participantes vean el mismo orden**, aunque escriban casi al mismo tiempo.

Servidor en Node.js + TypeScript con `ws`; cliente en React + Vite + TypeScript con el WebSocket nativo del navegador. El diseño completo, con las opciones evaluadas en cada decisión, está en [`design.md`](openspec/changes/archive/2026-09-24-add-support-chat/design.md), y los requisitos vigentes en [`openspec/specs/`](openspec/specs/).

---

## Cómo correrlo

**Requisitos:** Node.js 24 (versión fijada en [`.nvmrc`](.nvmrc)) y npm.

```bash
nvm use            # opcional; con nvm-windows: nvm use 24
npm install
npm run dev
```

`npm run dev` levanta a la vez el servidor WebSocket (puerto **3000**) y el front (puerto **5173**). Vite reenvía `/ws` al servidor, así que el navegador solo habla con `localhost:5173`.

Para probar con dos personas, abre dos ventanas distintas (una normal y otra **en incógnito**, para que no compartan sesión):

- Cliente: <http://localhost:5173/?role=cliente>
- Agente: <http://localhost:5173/?role=agente>

También puedes abrir <http://localhost:5173> y elegir el rol en la pantalla inicial. La conversación por defecto es `demo`; otra se abre con `&conversation=<nombre>` (minúsculas, números y guiones, hasta 64 caracteres).

Si el puerto 3000 está ocupado, el servidor acepta `SERVER_PORT`, pero el proxy de Vite apunta al 3000 ([`code/web/vite.config.ts`](code/web/vite.config.ts)), así que lo más simple es liberar el puerto. El servidor usa `SERVER_PORT` y no `PORT` a propósito: `PORT` suele venir definida por otras herramientas.

### Modo simulado

Con `?transport=mock` el front usa un servidor simulado en el navegador, sin backend. Desde la consola de DevTools se inyectan las fallas:

```js
chatMock.receiveFromOther('hola')   // mensaje del otro participante
chatMock.faults.duplicate = true    // cada mensaje llega dos veces
chatMock.faults.reorder = true      // los mensajes llegan en orden inverso
chatMock.faults.dropAcks = true     // se pierden los ACK: el message:new confirma igual, sin reintento
chatMock.dropConnection(20000)      // corta la conexión 20 s y reconecta sola
chatMock.restartServer()            // nuevo epoch, historial vacío
```

---

## Cómo probarlo

### Pruebas automáticas

```bash
npm test                 # unitarias e integración (Vitest)
npm run test:e2e:setup   # solo la primera vez: descarga Chromium para Playwright
npm run test:e2e         # E2E (Playwright); levanta servidor y front solo
```

| Suite | Pruebas | Qué cubre |
|---|---|---|
| Dominio ([`ChatService.test.ts`](code/server/src/domain/ChatService.test.ts)) | 8 | `seq` creciente, reintento con el mismo `seq`, mismo `messageId` de otro remitente, `findAfter`, ACK y difusión, validación del texto |
| Gateway ([`WsGateway.test.ts`](code/server/src/adapters/WsGateway.test.ts)) | 21 | Clientes `ws` reales: cierre 1008, `welcome` con `epoch`, ACK antes de la difusión, reintento sin re-difusión, `sender` ignorado, conversaciones aisladas, `INVALID_PAYLOAD`, `resume`, heartbeat, y tolerancia a clientes defectuosos: un frame sin máscara (enviado por un socket TCP crudo) y un mensaje de 17 KiB (cierre 1009) cierran solo esa conexión mientras las demás siguen funcionando; también un frame inválido en una conexión ya rechazada con 1008 |
| Reducer ([`chatReducer.test.ts`](code/web/src/state/chatReducer.test.ts)) | 6 | Duplicados, pendiente reubicado, `lastSeq` contiguo, reinicio por `epoch` |
| Sesión con `MockTransport` ([`chatSession.test.ts`](code/web/src/state/chatSession.test.ts)) | 8 | Duplicados y desorden, pendiente reubicado, intentos pausados durante una caída, 3 intentos, pendiente con el ACK perdido que llega confirmado por el `history` o por un `message:new` (no se reenvía), reinicio del servidor, error del servidor |
| E2E ([`e2e/`](e2e/)) | 5 | Reconexión con dos navegadores (sin duplicados, mismo orden), entrada al chat y aislamiento entre conversaciones |

Para **ver** las E2E: `npx playwright test --ui` (línea de tiempo con capturas de cada paso) o `npx playwright test --headed` (abre los navegadores).

**Sobre la E2E de reconexión:** en Chromium, `setOffline(true)` no cierra un WebSocket que ya está abierto. La prueba corta además el WebSocket con `routeWebSocket` y rechaza las reconexiones mientras dura la caída, y verifica que la interfaz muestre "Reconectando…" antes de seguir, para no pasar sin haber probado la reconexión.

### Prueba manual

1. Abre el cliente y el agente como se indica arriba y escribe desde ambos lados.
2. **Caída de un participante:** en la consola del agente pega lo siguiente, envía un mensaje y ejecuta `ws.close()`. Mientras reconecta, escribe desde el cliente: al volver, el agente recibe todo en orden y sin duplicados.
   ```js
   const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { window.ws = this; return s.call(this, d); };
   ```
   DevTools → Network → **Offline** puede no cortar un WebSocket ya abierto (el mismo caso de `setOffline`); si el indicador sigue en "Conectado", usa el fragmento.
3. **Reinicio del servidor:** detén `npm run dev` y vuelve a levantarlo. Ambos lados muestran "Reconectando…", limpian el historial (el servidor guarda en memoria) y reenvían lo que tenían pendiente.

> **Probar desde dos computadores:** el front genera el `messageId` con `crypto.randomUUID`, que el navegador solo permite en un contexto seguro (`localhost` o https). Si se abre el front por la IP de la red local con http (por ejemplo `http://192.168.1.20:5173`), enviar un mensaje falla. Para probar entre dos equipos, sírvelo por https o usa un túnel que entregue una URL https.

### Qué es normal ver en la consola

- **`[vite] ws proxy socket error: ECONNABORTED / ECONNRESET`** en la terminal al recargar o cerrar una pestaña, cortar la red o reiniciar el servidor: el proxy de desarrollo de Vite intentó reenviar un mensaje a una conexión que ya se cerró. Es ruido del entorno de desarrollo, no se pierden mensajes y en producción no existe.
- **`WebSocket connection to 'ws://localhost:5173/ws…' failed`** en el navegador mientras el servidor está caído: son los reintentos de reconexión.
- **404 de `favicon.ico`**: la app no tiene favicon.
- **`Conexión cerrada por error de protocolo: WS_ERR_…`** en la terminal del servidor: un cliente envió un frame WebSocket inválido (por ejemplo `WS_ERR_EXPECTED_MASK`) o un mensaje de más de 16 KiB (`WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`, cierre 1009). Se cierra solo esa conexión; el resto sigue igual. El front nunca lo provoca.

---

## Cómo funciona

```
Cliente A                       Servidor                        Cliente B
   | message:send {messageId} ---> | ¿existe (remitente, messageId)?
   |                               |   no: asigna seq y guarda
   | <--- message:ack {seq} ------ |
   | <--- message:new ------------ | ---- message:new ------------> |
```

Al reconectar, el cliente recibe `welcome {epoch}`, envía `resume {lastSeq}`, recibe en `history` lo que se perdió y **después** reenvía con el mismo `messageId` los pendientes que no llegaron confirmados en ese `history`.

### Estructura

```
code/
  server/src/
    domain/           ChatService y puertos (sin dependencias de infraestructura)
    adapters/         InMemoryMessageRepository y WsGateway (ws, validación, heartbeat, epoch)
    contract.ts       contrato de eventos (copia idéntica en code/web)
  web/src/
    transport/        ChatTransport, WebSocketTransport y MockTransport
    state/            chatReducer, cola de pendientes y sesión (sin React, para probarlos)
    hooks/ components/
e2e/                  pruebas de Playwright
openspec/             propuesta, specs, diseño y tareas
```

---

## Decisiones y trade-offs

Resumen; cada decisión tiene sus alternativas y el porqué en el `design.md` de su cambio: la 1 a la 9 en [`add-support-chat`](openspec/changes/archive/2026-09-24-add-support-chat/design.md) y la 10 en [`harden-delivery`](openspec/changes/archive/2026-09-24-harden-delivery/design.md).

| # | Decisión | Por qué | Trade-off |
|---|---|---|---|
| 1 | **WebSocket con `ws`**, sin Socket.IO | Canal bidireccional y ACK, orden y reconexión explícitos en el código; mismo modelo que API Gateway WebSocket | La reconexión se implementa a mano |
| 2 | **Al menos una vez + deduplicación**: ACK del servidor al emisor; el receptor se recupera por `lastSeq` | "Exactamente una vez" no se garantiza con el protocolo; la garantía real es la idempotencia | Reintentos: 5 s por intento, 3 intentos, y solo cuentan con la conexión abierta |
| 3 | **Orden por `seq` del servidor**, por conversación | Una sola autoridad; no depende de relojes ni tiene empates | Un mensaje propio "enviando" puede cambiar de lugar al recibir su `seq` |
| 4 | **Deduplicación por (conversación, remitente, `messageId`)**, con el id generado por el cliente | Todos los reintentos llevan el mismo id; otro remitente no puede "robar" un ACK ajeno | — |
| 5 | **Reconexión** con espera exponencial y jitter, `resume` y `epoch` | Recupera lo perdido sin ACK por mensaje; el `epoch` detecta reinicios del servidor | Los pendientes no sobreviven a una recarga (no se guardan en `localStorage`) |
| 6 | **Memoria detrás de un puerto** (`MessageRepository`) | Suficiente para una instancia; cambiar a una base de datos es escribir un adaptador | Un reinicio borra el historial |
| 7 | **Rol por URL**, fijado por el servidor al conectar | Simple y sin autenticación; el cliente no puede declarar otro remitente | Cualquiera puede entrar como agente |
| 8 | **Producción en AWS con API Gateway WebSocket** (solo documentado) | Ver abajo | — |
| 9 | **Pruebas**: unitarias del dominio y del estado del cliente, integración del gateway y E2E de reconexión | Cada propiedad del problema clásico se prueba por separado, y la E2E de punta a punta | La prueba de componentes quedó fuera |
| 10 | **Límite de 16 KiB por mensaje** (`maxPayload`) y **tolerancia a frames inválidos**: cada conexión escucha `error` y `ws` cierra solo esa conexión (1002 si el frame es inválido, 1009 si es demasiado grande) | Antes, un frame inválido de un solo cliente tumbaba el servidor para todos, y `ws` aceptaba hasta 100 MiB por mensaje. El mensaje válido más grande pesa unos 12 KB serializado. Validar el tamaño solo en la aplicación no sirve: `ws` ya bufferizó el payload | Un cliente hecho a mano que mande texto con mucho espacio alrededor puede superar el límite; el front recorta antes de enviar. No hay límite de tasa |

Dos detalles de implementación que no están a simple vista:

- Los puertos del dominio son **síncronos** a propósito: con el repositorio en memoria, revisar si el mensaje existe y guardarlo ocurre sin interrupciones. Con puertos `async`, dos copias del mismo mensaje en el mismo paquete TCP podrían pasar ambas la revisión.
- El servidor corre `.ts` directamente con Node 24 (sin `tsx` ni compilación), por eso el código usa solo sintaxis borrable e imports con extensión `.ts`.

### Despliegue en producción (decisión 8, no desplegado)

- **API Gateway WebSocket** mantiene las conexiones y enruta `$connect`, `$disconnect` y los mensajes a **Lambdas**. Como el dominio está separado, pasar del servidor `ws` a Lambdas es cambiar los adaptadores, no la lógica.
- **DynamoDB**: mensajes por conversación ordenados por `seq`; el `seq` sale de un contador atómico y una **escritura condicional** rechaza un `messageId` repetido del mismo remitente. `resume` es una consulta por `seq` mayor a `lastSeq`. Los ids de conexión también se guardan ahí y la difusión es `postToConnection`.
- Front estático en **S3 + CloudFront**; infraestructura con **Terraform** y pipelines; monitoreo de conexiones activas, mensajes por segundo, tiempo hasta el ACK y reconexiones.
- A considerar: las conexiones duran máximo 2 horas y se cierran tras 10 minutos sin actividad, así que el cliente necesitaría un mensaje periódico; la reconexión con `resume` ya cubre el cierre forzado.
- Alternativa evaluada: ECS Fargate con el mismo servidor `ws`, Redis Pub/Sub entre instancias y Postgres.

#### Del local a producción

El back en producción no es solo API Gateway. API Gateway mantiene las conexiones, Lambda ejecuta la lógica (el mismo `ChatService`) y DynamoDB guarda los mensajes y las conexiones.

| Local | Producción |
|---|---|
| `WsGateway` (conexión y validación) | API Gateway WebSocket y una Lambda por ruta (`$connect`, `$disconnect`, `message:send`, `resume`), con `$request.body.type` como route selection expression |
| Rol por `?role=` | Lambda authorizer en `$connect` (JWT); el rol y la conversación se guardan junto al `connectionId` |
| `ConnectionRegistry` / `MessageNotifier` | Tabla de conexiones en DynamoDB y `postToConnection` |
| `InMemoryMessageRepository` | Adaptador de DynamoDB |
| `ChatService` | El mismo. Solo cambian los adaptadores; para eso es la arquitectura hexagonal |
| `epoch` | Casi fijo: el historial sobrevive a los despliegues. Solo cambia si se reinician los datos |
| Heartbeat del servidor (ping/pong) | Ping de aplicación desde el cliente, y limpieza cuando `postToConnection` responde 410 Gone |
| `maxPayload` de 16 KiB | Validación en la Lambda. El límite de API Gateway es mayor (128 KB por mensaje, en frames de 32 KB), así que 16 KiB sigue siendo el tope real |

**Qué cambia al pasar a Lambda**

**a) `seq` sin huecos.** "Contador atómico + escritura condicional" deja huecos. Si el mensaje es un reintento, el contador ya subió cuando la escritura condicional lo rechaza. Ese `seq` queda sin mensaje, y como el cliente calcula `lastSeq` como el último `seq` contiguo, se quedaría esperando un `seq` que no existe. La solución es una sola `TransactWriteItems` con tres operaciones:

- actualizar el `lastSeq` de la conversación con la condición `lastSeq = :leído`;
- guardar el mensaje con `seq = leído + 1`;
- guardar la clave de idempotencia (conversación, remitente, `messageId`) con `attribute_not_exists`.

Si falla por la clave, es un duplicado: se busca el mensaje original y se responde el ACK con su `seq`. Si falla por `lastSeq`, otro mensaje ganó la carrera: se relee y se reintenta. Es el mismo problema de "revisar y guardar" sin interrupciones de los puertos síncronos (ver "Dos detalles de implementación"): en memoria lo resuelve el código síncrono; en DynamoDB, una transacción condicional.

> Esto corrige lo que dice la decisión 8 del `design.md` de `add-support-chat`; se detectó al revisar el paso a producción.

**b) `welcome` sin `$connect`.** Durante `$connect` la conexión todavía no existe y `postToConnection` falla. El contrato cambia en una sola cosa: el cliente envía `resume` al abrir, y el servidor responde `welcome` y `history`. Como el cliente envía el `resume` antes de recibir el `welcome`, el `resume` lleva el `epoch` que conoce el cliente. Si no coincide con el del servidor, el servidor responde el historial desde 0 y el cliente descarta sus mensajes confirmados, como hoy.

**c) Heartbeat del lado del cliente.** API Gateway no expone ping/pong a Lambda y cierra la conexión tras 10 minutos sin actividad. El cliente manda un ping de aplicación periódico. Eso además resuelve el riesgo de la conexión medio abierta del lado del cliente (ver "Riesgos conocidos"). Las conexiones muertas se borran cuando `postToConnection` responde 410 Gone.

---

## Términos

| Término | Significado |
|---|---|
| `messageId` | UUID que genera el cliente antes de enviar; clave de idempotencia junto con el remitente |
| `seq` | Número de orden que asigna el servidor, incremental por conversación; único criterio de orden |
| ACK | Respuesta del servidor al emisor que confirma la recepción y devuelve el `seq` |
| `lastSeq` | Último `seq` **contiguo** que tiene un cliente (no el mayor) |
| `epoch` | Id aleatorio que genera el servidor al iniciar; si cambia, el servidor se reinició |
| Pendiente | Mensaje propio enviado que todavía no tiene ACK ("enviando") |

---

## Riesgos conocidos y qué faltó

**Riesgos conocidos**

- **Conexión medio abierta del lado del cliente:** si la red se cae sin cerrar el WebSocket, el servidor lo detecta con el heartbeat (ping cada 30 s), pero el navegador puede tardar en notarlo. Mientras tanto, un envío se da por salido y puede terminar "no enviado" en lugar de quedar "enviando" hasta reconectar. La solución sería un heartbeat del lado del cliente (por ejemplo un `ping`/`pong` en el contrato), que no se implementó. En producción esto se resuelve con el ping del cliente (ver "Del local a producción").
- **Datos en memoria y una sola instancia:** un reinicio borra el historial (el `epoch` evita inconsistencias) y el servidor no escala horizontalmente tal cual (la decisión 8 describe el camino). Tampoco hay política de retención de mensajes.
- **Sin autenticación:** el servidor fija el rol por conexión, pero cualquiera puede entrar como agente.
- **Límite de 16 KiB por mensaje:** el servidor cierra con 1009 cualquier mensaje más grande. El mensaje válido más grande (2.000 caracteres) pesa hasta unos 12 KB serializado, así que el front nunca lo alcanza; un cliente hecho a mano que mande texto con mucho espacio alrededor (que no cuenta para los 2.000) sí podría. Tampoco hay límite de tasa: un cliente abusivo puede reconectar y volver a intentarlo, aunque solo pierde su propia conexión.

**Qué faltó**

- Prueba de componente de los estados "enviando", "enviado" y "no enviado" (opcional; habría requerido `@testing-library/react` y `jsdom`, fuera del stack; los estados ya están cubiertos por las pruebas del reducer y la E2E).
- Detección de huecos en el `seq` (si llega un `seq` mayor a `lastSeq + 1`, pedir `resume`) y el mensaje automático cuando no hay agentes conectados: quedaron como "si alcanza el tiempo".
- Guardar los pendientes en `localStorage` para que sobrevivan a una recarga.
- Fuera de alcance por diseño: lista de conversaciones para el agente, "está escribiendo", confirmación de leído, adjuntos y Docker.

---

## Tiempo invertido

**3 h 49 min** en total, dentro del límite de alrededor de 4 horas: la especificación y el diseño con OpenSpec, la implementación, las pruebas y este README.

La implementación, según el historial de commits, fue el 24 de septiembre de 2026:

| Etapa | Commit |
|---|---|
| Propuesta, specs y diseño (OpenSpec) | 19:33 |
| Estructura del proyecto | 19:39 |
| Contrato | 19:46 |
| Front con transporte simulado | 19:58 |
| Servidor `ws` | 20:04 |
| Estilo visual | 20:08 |
| Integración y reconexión | 20:29 |
| Pruebas | 20:49 |
| Habilitar `/opsx:verify` | 21:09 |
| Correcciones post-auditoría (harden-delivery) | 21:40 y 21:42 |
| Archivado de `add-support-chat` y `harden-delivery` | 21:52 |
| Fix y test: `error` en conexiones rechazadas | 22:05 y 22:17 |
| README, `CLAUDE.md` y paso a producción | 22:24 |

## Uso de IA

El trabajo se hizo con **OpenSpec** y **Claude Code**: primero la propuesta, las specs y el diseño (con las opciones evaluadas en cada decisión; ver la sección "Uso de IA en las decisiones" de `design.md`), después la implementación por secciones de `tasks.md`, revisando en cada una que respetara el contrato, que no agregara dependencias fuera del stack ni nada fuera de alcance, y que funcionara como se indica. Durante la implementación salieron ajustes que volvieron al diseño y a las specs, por ejemplo: que los intentos solo cuenten con la conexión abierta, que `lastSeq` sea el último `seq` contiguo, que la deduplicación sea por remitente y que `setOffline` no basta para cortar un WebSocket en la E2E.

Después de archivar el primer cambio se hizo una **auditoría asistida por IA** del código entregado. Encontró dos problemas: un frame WebSocket inválido de un solo cliente tumbaba el servidor para todos (y no había límite de tamaño por mensaje), y el cliente reenviaba pendientes que ya habían llegado confirmados en el `history` o en un `message:new`. Ambos se resolvieron con el cambio [`harden-delivery`](openspec/changes/archive/2026-09-24-harden-delivery/), con el mismo flujo de OpenSpec (propuesta, delta de specs, diseño y tareas), pruebas que fallan si se quita cada arreglo y la verificación con `/opsx:verify` antes de archivar. Al revisar la auditoría se corrigieron dos de sus afirmaciones: el mensaje válido más grande pesa unos 12 KB (no 8 KB), y el riesgo de que la interfaz marcara "no enviado" un mensaje ya confirmado no existía, porque el reducer ya lo impedía.
