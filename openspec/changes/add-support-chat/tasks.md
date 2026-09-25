# Tareas

Orden de trabajo: contrato → front con mocks → back → integración → pruebas. Tiempo total estimado: alrededor de 4 horas.

## 0. Scaffolding (20 min)

- [x] 0.1 Crear el repositorio público con la estructura: `openspec/` y `.claude/` en la raíz, y el código en `code/server` y `code/web`
- [x] 0.2 Ejecutar `openspec init --tools claude`, copiar la carpeta `openspec/` con esta spec y validar con `openspec validate add-support-chat --strict`
- [x] 0.3 Crear el `package.json` de la raíz con `npm run dev`, que levanta el servidor y el front a la vez con `concurrently`, y los scripts de pruebas
- [x] 0.4 Fijar la versión de Node con `.nvmrc` y el campo `engines`
- [x] 0.5 `.gitignore` con `node_modules`, `dist`, `.env`, `.claude/settings.local.json` y los resultados de Playwright

## 1. Contrato (20 min)

- [x] 1.1 Escribir `contract.ts` con los tipos de `Message`, `ClientEvent` y `ServerEvent`, en `code/server` y en `code/web`
- [x] 1.2 Revisar el contrato contra los escenarios de `message-delivery` y `support-conversation`

## 2. Front con mocks (55 min)

- [x] 2.1 Crear el proyecto con Vite + React + TypeScript en `code/web`
- [x] 2.2 Definir la interfaz `ChatTransport` e implementar `MockTransport`, capaz de inyectar duplicados, desorden y desconexiones
- [x] 2.3 Implementar `chatReducer`: fusión por remitente y `messageId`, orden por `seq` y pendientes al final
- [x] 2.4 Implementar la cola de pendientes: espera de 5 s por el ACK, 3 intentos y estado "no enviado". Los intentos solo cuentan con la conexión abierta: al caerse, el temporizador se pausa sin gastar intentos, y al reconectar el contador vuelve a cero
- [x] 2.5 Pantalla inicial para elegir el rol (cliente o agente) y vista del chat con los estados "enviando", "enviado" y "no enviado", más el aviso "Reconectando…"
- [x] 2.6 Estilo visual: tema oscuro, barra superior con el rol, el estado de la conexión ("Conectado", "Conectando…", "Reconectando…") y "Cambiar rol", mensajes propios como "Tú" y un textarea (Enter envía, Shift+Enter hace salto de línea) con placeholder según el rol. Sin lista de conversaciones ni "Cerrar conversación" (fuera de alcance)

## 3. Back (65 min)

- [x] 3.1 Dominio `ChatService` y puertos `MessageRepository` y `MessageNotifier` en `code/server`
- [x] 3.2 Adaptador `InMemoryMessageRepository`, con `seq` por conversación y `findByMessageId(conversationId, sender, messageId)`: la deduplicación es por remitente, no solo por `messageId`
- [x] 3.3 Gateway de `ws`: validar `role` y `conversation`, enviar `welcome` con el `epoch` y fijar el rol en la conexión
- [x] 3.4 Manejar `resume` y `message:send` (deduplicación, ACK y difusión), con validaciones y errores. La validación exige los campos requeridos e ignora los adicionales: un `sender` declarado por el cliente no se rechaza, solo se ignora
- [x] 3.5 Heartbeat con *ping* cada 30 s

## 4. Integración (15 min)

- [x] 4.1 Implementar `WebSocketTransport` con reconexión por espera exponencial y jitter
- [x] 4.2 Conectar el `epoch`, el `resume` y el reenvío de pendientes. `lastSeq` es el último `seq` contiguo: un `message:new` que llega antes del `history` se ubica por `seq`, pero no avanza `lastSeq` hasta que el hueco se llena
- [x] 4.3 Configurar el proxy de Vite para `/ws`

## 5. Pruebas (70 min)

- [x] 5.1 Unitarias del dominio con Vitest: `seq` creciente, `messageId` repetido del mismo remitente devuelve el mismo `seq`, el mismo `messageId` de otro remitente recibe un `seq` nuevo, `findAfter` devuelve solo lo posterior
- [x] 5.2 Unitarias del `chatReducer` con `MockTransport`: duplicado descartado, pendiente reubicado al llegar el ACK, intentos pausados durante la desconexión y `lastSeq` contiguo cuando un `message:new` llega antes del `history`
- [x] 5.3 Configurar Playwright: `@playwright/test` como dependencia de desarrollo, script `test:e2e:setup` que descarga Chromium con `npx playwright install chromium`, y `webServer` para levantar el servidor y el front antes de las pruebas
- [x] 5.4 E2E de reconexión: dos contextos de navegador (cliente y agente); se desconecta uno con `setOffline(true)` más `routeWebSocket` (en Chromium, `setOffline` no cierra un WebSocket ya abierto, así que el WebSocket se corta desde la prueba y se rechazan las reconexiones mientras dura la caída), el otro envía mensajes, se restaura la conexión y se verifica que no haya duplicados y que ambos vean el mismo orden
- [ ] 5.5 (Opcional) Prueba de componente de los estados "enviando", "enviado" y "no enviado"
- [x] 5.6 Integración del gateway con Vitest (20 min): levantar `WsGateway` en un puerto libre con un heartbeat corto y conectar clientes `ws` reales. Cubrir: `role` o `conversation` inválidos cierran con 1008; sin `conversation` entra a `demo`; `welcome` con `epoch`, rol y conversación; ACK antes del `message:new`; un reintento no se vuelve a difundir; el `sender` declarado por el cliente se ignora; conversaciones distintas no se mezclan; JSON inválido, UUID inválido, tipo desconocido y `lastSeq` negativo responden `INVALID_PAYLOAD` sin cerrar la conexión; `resume` devuelve solo lo posterior; una conexión que no responde el *ping* se cierra y deja de recibir mensajes
- [x] 5.7 E2E de entrada y aislamiento (10 min): desde la pantalla inicial, "Entrar como cliente" conecta a `demo`; `?role=agente` entra directo al chat; `conversation` inválida muestra el aviso; dos clientes en conversaciones distintas no ven los mensajes del otro

## 6. Verificación y README (30 min)

- [ ] 6.1 Recorrer a mano los escenarios de ambas specs: dos pestañas (una en incógnito), cortar la red con DevTools, red lenta y reinicio del servidor
- [ ] 6.2 Clonar el repositorio en otra carpeta y seguir el README desde cero
- [ ] 6.3 README: cómo correrlo, cómo probarlo, "Decisiones y trade-offs", términos, tiempo real invertido y qué faltó. Incluir como riesgo conocido que el cliente no detecta una conexión medio abierta (sin heartbeat del lado del cliente, un envío puede quedar "no enviado" en vez de "enviando"), y como ruido esperado el `ws proxy socket error` de Vite al cortar conexiones
- [ ] 6.4 `openspec validate add-support-chat --strict`, `/opsx:verify` y archivar el cambio

## Si el tiempo se aprieta

Orden de recorte, de lo primero a lo último:

1. Mensaje automático cuando no hay agentes
2. Prueba de componentes
3. E2E de entrada y aislamiento (5.7)
4. Detección de huecos en el `seq`
5. Integración del gateway (5.6)
6. Pruebas unitarias del `chatReducer` (la E2E cubre el flujo completo)

No se recortan: las pruebas del dominio y la E2E de reconexión. Todo lo que quede fuera se anota en el README con el porqué.

## Plan de commits

Un commit por etapa, en el orden de trabajo:

1. `chore: estructura del proyecto y spec con OpenSpec`
2. `feat: contrato del chat`
3. `feat(web): chat con transporte simulado`
4. `feat(server): servidor ws con seq, deduplicación y resume`
5. `feat: integración web-servidor y reconexión`
6. `test: dominio, reducer y E2E de reconexión`
7. `docs: README con decisiones y trade-offs`
