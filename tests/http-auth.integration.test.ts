import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';
import { BUSINESS_ID } from '../lib/constants';

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test('Next HTTP pipeline applies authentication and owner-role proxy checks before route handlers', { timeout: 90000 }, async () => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const distDir = `.next-http-tests-${process.pid}-${port}`;
  const distPath = path.resolve(distDir);
  if (fs.existsSync(distPath)) throw new Error(`Temporary Next.js output directory already exists: ${distDir}`);
  const generatedConfigFiles = ['next-env.d.ts', 'tsconfig.json'].map(file => {
    const filePath = path.resolve(file);
    return { filePath, content: fs.readFileSync(filePath, 'utf8') };
  });
  const secret = process.env.AUTH_SESSION_SECRET || 'conic-unit-test-session-secret-32-bytes-minimum';
  const logs: string[] = [];
  const server = spawn(process.execPath, [
    path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port)
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/conic-http-tests',
      MONGODB_DB: BUSINESS_ID,
      CONIC_BUSINESS_ID: BUSINESS_ID,
      AUTH_SESSION_SECRET: secret,
      CONIC_TEST_DIST_DIR: distDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.setEncoding('utf8').on('data', chunk => logs.push(String(chunk)));
  server.stderr.setEncoding('utf8').on('data', chunk => logs.push(String(chunk)));

  const stopServer = async () => {
    if (server.exitCode !== null) return;
    const exited = once(server, 'exit');
    server.kill();
    const result = await Promise.race([
      exited,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 10000))
    ]);
    if (!result) throw new Error('Next dev server did not stop after receiving a termination signal.');
  };

  const removeTemporaryOutput = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        fs.rmSync(distPath, { recursive: true, force: true });
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (!['EPERM', 'ENOTEMPTY', 'EBUSY'].includes(String(code)) || attempt === 19) throw error;
      }
      if (!fs.existsSync(distPath)) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (!fs.existsSync(distPath)) return;
      }
    }
    throw new Error('Temporary Next.js output directory kept reappearing after the dev server stopped.');
  };

  try {
    let ready = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(`${origin}/api/finance/rent`);
        if (response.status === 401) {
          ready = true;
          break;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    assert.equal(ready, true, `Next dev server did not become ready. ${String(lastError)} ${logs.join('').slice(-3000)}`);

    const unauthenticated = await fetch(`${origin}/api/finance/rent`);
    assert.equal(unauthenticated.status, 401);

    const viewerToken = createSessionToken({
      id: 'integration-viewer',
      email: 'viewer@example.test',
      businessId: BUSINESS_ID,
      role: 'viewer'
    });
    const ownerToken = createSessionToken({
      id: 'integration-owner',
      email: 'owner@example.test',
      businessId: BUSINESS_ID,
      role: 'owner'
    });

    const forbidden = await fetch(`${origin}/api/finance/rent`, {
      headers: { Cookie: `${SESSION_COOKIE}=${viewerToken}` }
    });
    assert.equal(forbidden.status, 403);
    assert.match(((await forbidden.json()) as { error: string }).error, /does not have access/i);

    const ownerResponse = await fetch(`${origin}/api/auth/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=${ownerToken}` }
    });
    assert.equal(ownerResponse.status, 200);
    assert.deepEqual(await ownerResponse.json(), { email: 'owner@example.test', role: 'owner' });
  } finally {
    await stopServer();
    try {
      await removeTemporaryOutput();
    } finally {
      for (const { filePath, content } of generatedConfigFiles) {
        const current = fs.readFileSync(filePath, 'utf8');
        if (current.includes(distDir)) fs.writeFileSync(filePath, content);
      }
    }
  }
});
