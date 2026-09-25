import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { ChatService } from './domain/ChatService.ts';
import { InMemoryMessageRepository } from './adapters/InMemoryMessageRepository.ts';
import { ConnectionRegistry, WsGateway } from './adapters/WsGateway.ts';

const PORT = Number(process.env.PORT ?? 3000);

// Si cambia, los clientes saben que el servidor se reinició y perdió el historial (decisión 5).
const epoch = randomUUID();

const server = createServer((_request, response) => {
  response.writeHead(404).end();
});

const registry = new ConnectionRegistry();
const chat = new ChatService(new InMemoryMessageRepository(), registry);
new WsGateway({ server, chat, registry, epoch });

server.listen(PORT, () => {
  console.log(`Servidor listo en ws://localhost:${PORT}/ws (epoch ${epoch})`);
});
