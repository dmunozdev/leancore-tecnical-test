# Tareas

Orden de trabajo: servidor → cliente → verificación. Cada grupo incluye sus propias pruebas. Tiempo total estimado: alrededor de 1 hora.

## 1. Servidor: tolerancia a clientes defectuosos (30 min)

- [x] 1.1 En `code/server/src/adapters/WsGateway.ts`, crear el `WebSocketServer` con `maxPayload` de 16 KiB (constante exportada `MAX_PAYLOAD_BYTES = 16 * 1024`) y, en `onConnection`, agregar `socket.on('error', …)` que registre el código con `console.warn` sin cerrar a mano (lo cierra `ws`). Verificación: `npm run typecheck -w code/server` sin errores
- [x] 1.2 En `code/server/src/adapters/WsGateway.test.ts`, prueba del frame mal formado: un `net.Socket` crudo hace el handshake manual y envía el frame sin máscara `Buffer.from([0x81, 0x02, 0x68, 0x69])`; se verifica que esa conexión se cierra, que otro cliente conectado antes sigue abierto y que un cliente nuevo puede conectarse, enviar y recibir su ACK y el `message:new`. Verificación: la prueba pasa, y falla si se quita el listener de `error` (el proceso de la prueba muere)
- [x] 1.3 En el mismo archivo, prueba del mensaje mayor al límite: un cliente `ws` envía un payload de 17 KiB; se verifica cierre con código 1009 y que otro cliente sigue enviando y recibiendo. Verificación: la prueba pasa, y falla si se quita `maxPayload`
- [x] 1.4 Agregar al README, en "Qué es normal ver en la consola", el `console.warn` de un cliente que envía un frame inválido o de más de 16 KiB, y mencionar el límite en "Riesgos conocidos". Verificación: los links del README siguen resolviendo

## 2. Cliente: pendientes confirmados sin ACK (20 min)

- [x] 2.1 En `code/web/src/state/chatSession.ts`: en `history`, antes de `queue.resume()`, llamar `queue.ack(m.messageId)` para cada mensaje con `m.sender === getState().role`; en `message:new`, lo mismo si el `sender` es el rol de la sesión. Verificación: `npm run typecheck -w code/web` sin errores
- [x] 2.2 En `code/web/src/state/chatSession.test.ts`, con timers falsos y el `MockTransport`: un pendiente cuyo ACK se pierde en una caída (`faults.dropAcks` + `dropConnection`) y que llega en el `history` al reconectar queda `sent` con su `seq`, y tras `resume` no hay ningún `message:send` nuevo. Verificación: la prueba pasa, y falla si se quita el `queue.ack` del `history`
- [x] 2.3 En el mismo archivo: un pendiente con el ACK perdido que llega confirmado por `message:new` queda `sent` y no se reenvía en los reintentos (se avanzan más de 15 s sin ningún `message:send` nuevo). Verificación: la prueba pasa, y falla si se quita el `queue.ack` del `message:new`

## 3. Verificación final (10 min)

- [x] 3.1 Correr `npm test` y `npm run test:e2e` completos (con los puertos 3000 y 5173 libres antes y después) y `openspec validate harden-delivery --strict`. Verificación: todo en verde y ningún proceso colgado
