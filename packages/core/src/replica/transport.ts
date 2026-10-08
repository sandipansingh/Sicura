import { createServer, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { AppError } from '../errors';

/** Local-only transport for Docker internal networks that do not publish ports.
 * The relay's command and destination are immutable application constants.
 * PostgreSQL still authenticates every connection with its own DB identity.
 */
export async function openReplicaTransport(
  container: string,
): Promise<{ port: number; close(): Promise<void> }> {
  if (!/^proofsec_[a-f0-9]{32}$/.test(container)) throw new AppError('REPLICA_BINDING_INVALID');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    const relay = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'bash',
        '-c',
        'exec 3<>/dev/tcp/127.0.0.1/5432; cat <&3 & reader=$!; cat >&3; wait "$reader"',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    socket.pipe(relay.stdin);
    relay.stdout.pipe(socket);
    relay.on('error', () => socket.destroy());
    relay.stdin.on('error', () => socket.destroy());
    relay.on('close', () => socket.destroy());
    socket.on('error', () => relay.kill());
    socket.on('close', () => {
      sockets.delete(socket);
      relay.kill();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new AppError('REPLICA_BINDING_INVALID');
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
