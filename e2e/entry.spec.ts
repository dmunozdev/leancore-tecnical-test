import { expect, test } from '@playwright/test';

test.describe('entrada al chat', () => {
  test('desde la pantalla inicial, "Entrar como cliente" conecta a demo', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar como agente' })).toBeVisible();

    await page.getByRole('button', { name: 'Entrar como cliente' }).click();

    await expect(page).toHaveURL(/role=cliente/);
    await expect(page).toHaveURL(/conversation=demo/);
    await expect(page.locator('.badge')).toHaveText('Cliente');
    await expect(page.getByRole('status')).toHaveText('Conectado');
  });

  test('con ?role=agente entra directo al chat, sin pasar por la pantalla inicial', async ({ page }) => {
    await page.goto('/?role=agente');

    await expect(page.locator('.badge')).toHaveText('Agente');
    await expect(page.getByRole('status')).toHaveText('Conectado');
    await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveAttribute('placeholder', 'Responde al cliente…');
    await expect(page.getByRole('button', { name: 'Entrar como cliente' })).toHaveCount(0);
  });

  test('una conversation inválida muestra el aviso y no abre el chat', async ({ page }) => {
    await page.goto('/?role=cliente&conversation=Mal%20Nombre');

    await expect(page.getByText('no es válida')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveCount(0);
  });
});

test('dos clientes en conversaciones distintas no ven los mensajes del otro', async ({ browser }) => {
  const run = Date.now();
  const [convA, convB] = [`a-${run}`, `b-${run}`];
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [clientA, agentA, clientB] = await Promise.all(contexts.map((c) => c.newPage()));

  await clientA.goto(`/?role=cliente&conversation=${convA}`);
  await agentA.goto(`/?role=agente&conversation=${convA}`);
  await clientB.goto(`/?role=cliente&conversation=${convB}`);
  for (const page of [clientA, agentA, clientB]) await expect(page.getByRole('status')).toHaveText('Conectado');

  await clientA.getByRole('textbox', { name: 'Mensaje' }).fill('Solo para la conversación A');
  await clientA.getByRole('button', { name: 'Enviar' }).click();
  await clientB.getByRole('textbox', { name: 'Mensaje' }).fill('Solo para la conversación B');
  await clientB.getByRole('button', { name: 'Enviar' }).click();

  // Control positivo: el agente de A sí recibe el mensaje de A.
  await expect(agentA.locator('.message')).toHaveText([/Solo para la conversación A/]);
  await expect(clientB.locator('.message--own .message__status')).toHaveText('enviado');

  // Cada cliente ve solo su propio mensaje, con seq 1 en su conversación.
  await expect(clientA.locator('.message')).toHaveText([/Solo para la conversación A/]);
  await expect(clientB.locator('.message')).toHaveText([/Solo para la conversación B/]);
  await expect(clientB.locator('.message').first()).toHaveAttribute('data-seq', '1');

  // Y tampoco aparece al recargar (resume(0) de la conversación B).
  await clientB.reload();
  await expect(clientB.getByRole('status')).toHaveText('Conectado');
  await expect(clientB.locator('.message')).toHaveText([/Solo para la conversación B/]);

  await Promise.all(contexts.map((c) => c.close()));
});
