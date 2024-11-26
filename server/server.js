import Hyperswarm from 'hyperswarm';
import Docker from 'dockerode';
import crypto from 'hypercore-crypto';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const swarm = new Hyperswarm();
const connectedPeers = new Set();

// Generate a topic for the server
const topic = crypto.randomBytes(32);
console.log(`[INFO] Server started with topic: ${topic.toString('hex')}`);

swarm.join(topic, { server: true, client: false });

swarm.on('connection', (peer) => {
  console.log(`[INFO] Peer connected`);
  connectedPeers.add(peer);

  peer.on('data', async (data) => {
    try {
      const parsedData = JSON.parse(data.toString());
      console.log(`[DEBUG] Received data from peer: ${JSON.stringify(parsedData)}`);
      let response;

      switch (parsedData.command) {
        case 'listContainers':
          console.log(`[INFO] Handling 'listContainers' command`);
          const containers = await docker.listContainers({ all: true });
          response = { type: 'containers', data: containers };
          break;

        case 'startContainer':
          console.log(`[INFO] Handling 'startContainer' command for container: ${parsedData.args.id}`);
          await docker.getContainer(parsedData.args.id).start();
          response = { success: true, message: `Container ${parsedData.args.id} started` };
          break;

        case 'stopContainer':
          console.log(`[INFO] Handling 'stopContainer' command for container: ${parsedData.args.id}`);
          await docker.getContainer(parsedData.args.id).stop();
          response = { success: true, message: `Container ${parsedData.args.id} stopped` };
          break;

        case 'removeContainer':
          console.log(`[INFO] Handling 'removeContainer' command for container: ${parsedData.args.id}`);
          await docker.getContainer(parsedData.args.id).remove({ force: true });
          response = { success: true, message: `Container ${parsedData.args.id} removed` };
          break;

        case 'startTerminal':
          console.log(`[INFO] Starting terminal for container: ${parsedData.args.containerId}`);
          handleTerminal(parsedData.args.containerId, peer);
          return; // No response needed for streaming

        default:
          console.warn(`[WARN] Unknown command: ${parsedData.command}`);
          response = { error: 'Unknown command' };
      }

      console.log(`[DEBUG] Sending response to peer: ${JSON.stringify(response)}`);
      peer.write(JSON.stringify(response));
    } catch (err) {
      console.error(`[ERROR] Failed to handle data from peer: ${err.message}`);
      peer.write(JSON.stringify({ error: err.message }));
    }
  });

  peer.on('close', () => {
    console.log(`[INFO] Peer disconnected`);
    connectedPeers.delete(peer);
  });
});

// Stream Docker events to all peers
docker.getEvents({}, (err, stream) => {
  if (err) {
    console.error(`[ERROR] Failed to get Docker events: ${err.message}`);
    return;
  }

  stream.on('data', async (chunk) => {
    try {
      const event = JSON.parse(chunk.toString());
      console.log(`[INFO] Docker event received: ${event.status} - ${event.id}`);

      // Get updated container list and broadcast
      const containers = await docker.listContainers({ all: true });
      const update = { type: 'containers', data: containers };

      for (const peer of connectedPeers) {
        peer.write(JSON.stringify(update));
      }
    } catch (err) {
      console.error(`[ERROR] Failed to process Docker event: ${err.message}`);
    }
  });
});

async function handleTerminal(containerId, peer) {
  const container = docker.getContainer(containerId);

  try {
    const exec = await container.exec({
      Cmd: ['/bin/sh'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    console.log(`[INFO] Terminal session started for container: ${containerId}`);

    stream.on('data', (chunk) => {
      console.log(`[DEBUG] Terminal output: ${chunk.toString()}`);
      peer.write(JSON.stringify({ type: 'terminalOutput', containerId, data: chunk.toString() }));
    });

    peer.on('data', (input) => {
      try {
        const parsed = JSON.parse(input.toString());
        if (parsed.type === 'terminalInput' && parsed.data) {
          console.log(`[DEBUG] Terminal input: ${parsed.data}`);
          stream.write(parsed.data);
        }
      } catch (err) {
        console.error(`[ERROR] Failed to parse terminal input: ${err.message}`);
      }
    });

    peer.on('close', () => {
      console.log(`[INFO] Peer disconnected, ending terminal session for container: ${containerId}`);
      stream.end();
    });
  } catch (err) {
    console.error(`[ERROR] Failed to start terminal for container ${containerId}: ${err.message}`);
    peer.write(JSON.stringify({ error: `Failed to start terminal: ${err.message}` }));
  }
}

process.on('SIGINT', () => {
  console.log(`[INFO] Server shutting down`);
  swarm.destroy();
  process.exit();
});
