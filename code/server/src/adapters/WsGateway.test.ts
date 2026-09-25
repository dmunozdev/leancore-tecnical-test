import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect as connectSocket, type AddressInfo, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerEvent } from '../contract.ts';
import { ChatService } from '../domain/ChatService.ts';
import { InMemoryMessageRepository } from './InMemoryMessageRepository.ts';
import { ConnectionRegistry, MAX_PAYLOAD_BYTES, WsGateway } from './WsGateway.ts';

const HEARTBEAT_MS = 100;
const EPOCH = 'epoch-de-prueba';

/** Cliente `ws` real que guarda todo lo que recibe. */
class TestClient {
  readonly events: ServerEvent[] = [];
  readonly closed: Promise<number>;
  private readonly socket: WebSocket;

  constructor(url: string, options?: { autoPong?: boolean }) {
    this.socket = new WebSocket(url, options);
    this.socket.on('message', (data) => this.events.push(JSON.parse(String(data)) as ServerEvent));
    this.closed = new Promise((resolve) => this.socket.on('close', (code) => resolve(code)));
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(event: unknown): void {
    this.socket.send(typeof event === 'string' ? event : JSON.stringify(event));
  }

  of<T extends ServerEvent['type']>(type: T): Extract<ServerEvent, { type: T }>[] {
    return this.events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);
  }

  /** Espera hasta que haya `count` eventos del tipo dado. */
  async waitFor<T extends ServerEvent['type']>(type: T, count = 1, timeoutMs = 2000) {
    const start = Date.now();
    while (this.of(type).length < count) {
      if (Date.now() - start > timeoutMs) throw new Error(`No llegaron ${count} eventos ${type}: ${JSON.stringify(this.events)}`);
      await sleep(10);
    }
    return this.of(type);
  }

  close(): void {
    this.socket.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('WsGateway (integración con clientes ws reales)', () => {
  let server: Server;
  let gateway: WsGateway;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    server = createServer();
    const registry = new ConnectionRegistry();
    const chat = new ChatService(new InMemoryMessageRepository(), registry);
    gateway = new WsGateway({ server, chat, registry, epoch: EPOCH, heartbeatIntervalMs: HEARTBEAT_MS });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    gateway.close();
    await new Promise((resolve) => server.close(resolve));
  });

  function connect(query: string, options?: { autoPong?: boolean }): TestClient {
    const client = new TestClient(`ws://localhost:${port}/ws${query}`, options);
    clients.push(client);
    return client;
  }

  /** Conecta y espera el `welcome`. */
  async function join(role: 'cliente' | 'agente', conversation = 'demo', options?: { autoPong?: boolean }) {
    const client = connect(`?role=${role}&conversation=${conversation}`, options);
    await client.waitFor('welcome');
    return client;
  }

  const sendMessage = (client: TestClient, text: string, messageId = randomUUID(), extra: object = {}) => {
    client.send({ type: 'message:send', messageId, text, ...extra });
    return messageId;
  };

  describe('conexión', () => {
    it.each([
      ['un role inválido', '?role=admin&conversation=demo'],
      ['sin role', '?conversation=demo'],
      ['una conversation inválida', '?role=cliente&conversation=Mal%20Nombre'],
      ['una conversation demasiado larga', `?role=cliente&conversation=${'a'.repeat(65)}`],
    ])('cierra con 1008 ante %s', async (_, query) => {
      expect(await connect(query).closed).toBe(1008);
    });

    it('sin conversation entra a demo', async () => {
      const client = connect('?role=cliente');
      const [welcome] = await client.waitFor('welcome');
      expect(welcome.conversationId).toBe('demo');
    });

    it('envía welcome con el epoch, el rol y la conversación', async () => {
      const client = await join('agente', 'soporte-1');
      expect(client.of('welcome')[0]).toEqual({ type: 'welcome', epoch: EPOCH, role: 'agente', conversationId: 'soporte-1' });
    });
  });

  describe('envío y difusión', () => {
    it('responde el ACK al emisor antes del message:new y difunde a la conversación', async () => {
      const client = await join('cliente');
      const agent = await join('agente');

      const id = sendMessage(client, 'Hola');
      await client.waitFor('message:new');
      const [newForAgent] = await agent.waitFor('message:new');

      const types = client.events.map((e) => e.type);
      expect(types.indexOf('message:ack')).toBeLessThan(types.indexOf('message:new'));
      expect(client.of('message:ack')[0]).toMatchObject({ messageId: id, seq: 1 });
      expect(newForAgent.message).toMatchObject({ messageId: id, seq: 1, sender: 'cliente', text: 'Hola' });
    });

    it('un reintento recibe el mismo ACK y no se vuelve a difundir', async () => {
      const client = await join('cliente');
      const agent = await join('agente');

      const id = sendMessage(client, 'Hola');
      await agent.waitFor('message:new');
      sendMessage(client, 'Hola', id);
      const acks = await client.waitFor('message:ack', 2);
      await sleep(100);

      expect(acks.map((a) => a.seq)).toEqual([1, 1]);
      expect(agent.of('message:new')).toHaveLength(1);
    });

    it('ignora el sender declarado por el cliente y usa el rol de la conexión', async () => {
      const client = await join('cliente');
      sendMessage(client, 'Soy el agente, créeme', randomUUID(), { sender: 'agente' });
      const [{ message }] = await client.waitFor('message:new');
      expect(message.sender).toBe('cliente');
    });

    it('las conversaciones distintas no se mezclan', async () => {
      const clientA = await join('cliente', 'conv-a');
      const agentB = await join('agente', 'conv-b');

      sendMessage(clientA, 'Solo para conv-a');
      await clientA.waitFor('message:new');
      await sleep(100);

      expect(agentB.of('message:new')).toEqual([]);
      agentB.send({ type: 'resume', lastSeq: 0 });
      const [history] = await agentB.waitFor('history');
      expect(history.messages).toEqual([]);
    });

    it('resume devuelve solo lo posterior a lastSeq', async () => {
      const client = await join('cliente');
      for (const text of ['uno', 'dos', 'tres']) sendMessage(client, text);
      await client.waitFor('message:ack', 3);

      client.send({ type: 'resume', lastSeq: 1 });
      const [history] = await client.waitFor('history');
      expect(history.messages.map((m) => m.seq)).toEqual([2, 3]);
    });
  });

  describe('validación', () => {
    it.each([
      ['JSON inválido', '{no es json'],
      ['un messageId que no es UUID', { type: 'message:send', messageId: 'abc', text: 'hola' }],
      ['un tipo desconocido', { type: 'desconocido' }],
      ['un lastSeq negativo', { type: 'resume', lastSeq: -1 }],
      ['un lastSeq no entero', { type: 'resume', lastSeq: 1.5 }],
    ])('responde INVALID_PAYLOAD ante %s sin cerrar la conexión', async (_, payload) => {
      const client = await join('cliente');
      client.send(payload);
      const [error] = await client.waitFor('error');
      expect(error.code).toBe('INVALID_PAYLOAD');
      expect(client.isOpen).toBe(true);
    });

    it('responde INVALID_TEXT con el messageId ante un texto vacío', async () => {
      const client = await join('cliente');
      const id = sendMessage(client, '   ');
      const [error] = await client.waitFor('error');
      expect(error).toMatchObject({ code: 'INVALID_TEXT', messageId: id });
    });
  });

  describe('tolerancia a clientes defectuosos', () => {
    /**
     * Handshake WebSocket manual por un socket crudo, para poder mandar un frame que ws jamás
     * produciría: uno de cliente sin máscara. Node exige la máscara (RFC 6455 §5.1); ws la valida
     * al parsear y, sin listener de 'error' en el socket, tumbaba todo el proceso.
     * Resuelve cuando el servidor cierra el socket crudo.
     */
    async function sendUnmaskedFrame(query: string): Promise<void> {
      const raw: Socket = connectSocket(port, 'localhost');
      const handshakeDone = new Promise<void>((resolve) => raw.once('data', () => resolve()));
      raw.on('error', () => {});
      raw.write(
        `GET /ws${query} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      await handshakeDone;
      const rawClosed = new Promise<void>((resolve) => raw.once('close', () => resolve()));
      raw.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); // frame de texto "hi", FIN, sin bit de máscara
      await rawClosed;
    }

    it('un frame mal formado cierra solo esa conexión; el servidor y las demás siguen vivos', async () => {
      const survivor = await join('agente');

      await sendUnmaskedFrame('?role=cliente');

      // El servidor sigue atendiendo: la conexión anterior sigue abierta y una nueva funciona.
      expect(survivor.isOpen).toBe(true);
      const newcomer = await join('cliente');
      const id = sendMessage(newcomer, 'sigo viva');
      const [ack] = await newcomer.waitFor('message:ack');
      expect(ack).toMatchObject({ messageId: id });
      const [event] = await survivor.waitFor('message:new');
      expect(event.message).toMatchObject({ messageId: id, text: 'sigo viva' });
    });

    it('un frame mal formado en una conexión rechazada con 1008 no tumba el servidor', async () => {
      const survivor = await join('agente');

      // El servidor acepta el upgrade y luego la cierra con 1008 por el role; mientras espera el
      // cierre del cliente, sigue leyendo frames, así que el frame inválido también llega aquí.
      await sendUnmaskedFrame('?role=hacker');

      expect(survivor.isOpen).toBe(true);
      const newcomer = await join('cliente');
      const id = sendMessage(newcomer, 'sigo viva');
      const [ack] = await newcomer.waitFor('message:ack');
      expect(ack).toMatchObject({ messageId: id });
      const [event] = await survivor.waitFor('message:new');
      expect(event.message).toMatchObject({ messageId: id, text: 'sigo viva' });
    });

    it('un mensaje mayor a maxPayload cierra esa conexión con 1009; el servidor y las demás siguen vivos', async () => {
      const survivor = await join('agente');
      const tooBig = connect('?role=cliente');
      await tooBig.waitFor('welcome');

      tooBig.send('x'.repeat(MAX_PAYLOAD_BYTES + 1024));
      expect(await tooBig.closed).toBe(1009);

      expect(survivor.isOpen).toBe(true);
      const newcomer = await join('cliente');
      const id = sendMessage(newcomer, 'sigo viva');
      await newcomer.waitFor('message:ack');
      const [event] = await survivor.waitFor('message:new');
      expect(event.message).toMatchObject({ messageId: id, text: 'sigo viva' });
    });
  });

  describe('heartbeat', () => {
    it('cierra una conexión que no responde el ping y deja de enviarle mensajes', async () => {
      const client = await join('cliente');
      const dead = await join('agente', 'demo', { autoPong: false });

      await dead.closed;
      const received = dead.events.length;
      sendMessage(client, 'después del heartbeat');
      await client.waitFor('message:new');

      expect(dead.events.length).toBe(received);
      // Las conexiones que sí responden siguen abiertas tras varios ciclos.
      await sleep(HEARTBEAT_MS * 3);
      expect(client.isOpen).toBe(true);
    });
  });
});
