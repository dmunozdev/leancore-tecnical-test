# Propuesta: chat de soporte en tiempo real

## Por qué

Un cliente necesita escribirle a un agente de soporte y ver sus respuestas sin recargar la página. En un chat de soporte, un mensaje perdido significa un cliente sin respuesta, y un mensaje duplicado o desordenado genera confusión en la conversación.

El reto técnico no es enviar mensajes, sino garantizar que:

- ningún mensaje se pierda aunque la conexión se caiga;
- un reintento no se convierta en un mensaje duplicado;
- ambos participantes vean exactamente el mismo orden, incluso cuando escriben casi al mismo tiempo.

## Qué cambia

- **Servidor WebSocket** que asigna un `seq` por conversación, deduplica por `messageId`, confirma cada mensaje con un ACK y permite recuperar los mensajes perdidos con `resume`.
- **Cliente web** con selección de rol al entrar (cliente o agente), que muestra los mensajes ordenados por `seq`, reintenta los envíos sin confirmar y se reconecta automáticamente.
- **Detección de reinicio del servidor** mediante un `epoch`.
- **Ejecución local** con un solo comando, `npm run dev`.
- **Pruebas unitarias** del dominio y del estado del cliente, y una **prueba E2E** de reconexión con Playwright.
- **Documentación del despliegue en producción** con API Gateway WebSocket, sin desplegarlo.

## Impacto

- **Specs afectadas:** `message-delivery` y `support-conversation` (nuevas).
- **Código:** `code/server/`, `code/web/` y el `package.json` de la raíz.
