import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * Simula una caída de red real para un contexto. `setOffline(true)` de Chromium no cierra un
 * WebSocket que ya está abierto, así que además se intercepta el `/ws`: al cortar se cierran las
 * conexiones abiertas y, mientras dure la caída, se rechazan las reconexiones.
 */
async function controllableNetwork(context: BrowserContext) {
  let offline = false;
  const open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();

  await context.routeWebSocket(/\/ws\b/, (page) => {
    if (offline) {
      page.close({ code: 4000, reason: 'sin red (simulado)' });
      return;
    }
    // Sin handlers de mensajes, Playwright reenvía todo en ambos sentidos.
    const connection = { page, server: page.connectToServer() };
    open.add(connection);
    page.onClose(() => open.delete(connection));
  });

  return {
    async cut() {
      offline = true;
      await context.setOffline(true);
      for (const { page, server } of open) {
        await server.close();
        await page.close({ code: 4000, reason: 'sin red (simulado)' });
      }
      open.clear();
    },
    async restore() {
      offline = false;
      await context.setOffline(false);
    },
  };
}

/** Mensajes en pantalla, en el orden mostrado: "seq|remitente|texto". */
async function visibleMessages(page: Page): Promise<string[]> {
  return page.locator('.message').evaluateAll((items) =>
    items.map((li) => {
      const el = li as HTMLElement;
      const text = el.querySelector('.message__text')?.textContent ?? '';
      const own = el.classList.contains('message--own');
      return `${el.dataset.seq ?? '-'}|${own ? 'propio' : 'otro'}|${text}`;
    }),
  );
}

/** El mismo historial visto desde el otro lado: se invierte propio/otro. */
const fromOtherSide = (messages: string[]) =>
  messages.map((m) => m.replace(/\|(propio|otro)\|/, (_, who) => (who === 'propio' ? '|otro|' : '|propio|')));

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Mensaje' }).fill(text);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

test('reconexión: sin duplicados y el mismo orden para cliente y agente', async ({ browser }) => {
  // Conversación propia de esta corrida: el servidor guarda en memoria y puede venir de otra corrida.
  const conversation = `e2e-${Date.now()}`;
  const clientContext = await browser.newContext();
  const agentContext = await browser.newContext();
  const client = await clientContext.newPage();
  const agent = await agentContext.newPage();
  const agentNetwork = await controllableNetwork(agentContext);

  await client.goto(`/?role=cliente&conversation=${conversation}`);
  await agent.goto(`/?role=agente&conversation=${conversation}`);
  await expect(client.getByRole('status')).toHaveText('Conectado');
  await expect(agent.getByRole('status')).toHaveText('Conectado');

  // Intercambio antes de la caída.
  await send(client, 'Hola, necesito ayuda');
  await send(agent, 'Hola, ¿en qué te ayudo?');
  await expect(agent.locator('.message')).toHaveCount(2);

  // Se cae la red del agente. Se verifica que la caída es real: si el WebSocket siguiera abierto,
  // la prueba pasaría sin probar la reconexión.
  await agentNetwork.cut();
  await expect(agent.getByRole('status')).toHaveText('Reconectando…');

  // El cliente escribe mientras el agente está desconectado, y el agente también intenta escribir.
  await send(client, 'Mi pedido es el 4512');
  await send(client, '¿Sigues ahí?');
  await send(client, 'Te espero');
  await send(agent, 'Escrito sin conexión');
  await expect(client.locator('.message--own .message__status').last()).toHaveText('enviado');
  await expect(agent.locator('.message--own .message__status').last()).toHaveText('enviando');

  await agentNetwork.restore();
  await expect(agent.getByRole('status')).toHaveText('Conectado', { timeout: 20_000 });
  await expect(agent.locator('.message')).toHaveCount(6, { timeout: 10_000 });
  await expect(client.locator('.message')).toHaveCount(6, { timeout: 10_000 });
  await expect(agent.locator('.message--own .message__status').last()).toHaveText('enviado');

  const clientView = await visibleMessages(client);
  const agentView = await visibleMessages(agent);

  // Sin duplicados.
  expect(new Set(clientView).size).toBe(clientView.length);
  expect(new Set(agentView).size).toBe(agentView.length);
  // Todos confirmados, con seq 1..6 en orden.
  expect(clientView.map((m) => m.split('|')[0])).toEqual(['1', '2', '3', '4', '5', '6']);
  // El mismo orden en ambos lados.
  expect(fromOtherSide(agentView)).toEqual(clientView);
  // Lo que el cliente escribió durante la caída le llegó al agente en orden, y el pendiente salió después.
  expect(clientView.slice(2)).toEqual([
    '3|propio|Mi pedido es el 4512',
    '4|propio|¿Sigues ahí?',
    '5|propio|Te espero',
    '6|otro|Escrito sin conexión',
  ]);

  await clientContext.close();
  await agentContext.close();
});
