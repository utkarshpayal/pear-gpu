// server.js

import Hyperswarm from 'hyperswarm';
import Docker from 'dockerode';
import crypto from 'hypercore-crypto';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const swarm = new Hyperswarm();
const connectedPeers = new Set();
const terminalSessions = new Map(); // Map to track terminal sessions per peer

// Generate a topic for the server
const topic = crypto.randomBytes(32);
console.log(`[INFO] Server started with topic: ${topic.toString('hex')}`);

// Join the swarm with the generated topic
swarm.join(topic, { server: true, client: false });

// Handle incoming peer connections
swarm.on('connection', (peer) => {
  console.log('[INFO] Peer connected');
  connectedPeers.add(peer);

  peer.on('data', async (data) => {
    try {
      const parsedData = JSON.parse(data.toString());
      console.log(`[DEBUG] Received data from peer: ${JSON.stringify(parsedData)}`);
      let response;

      switch (parsedData.command) {
        case 'listContainers':
          console.log('[INFO] Handling \'listContainers\' command');
          const containers = await docker.listContainers({ all: true });
          response = { type: 'containers', data: containers };
          break;

        case 'inspectContainer':
          console.log(`[INFO] Handling 'inspectContainer' command for container: ${parsedData.args.id}`);
          const container = docker.getContainer(parsedData.args.id);
          const config = await container.inspect();
          response = { type: 'containerConfig', data: config };
          break;

        case 'duplicateContainer':
          console.log('[INFO] Handling \'duplicateContainer\' command');
          const { name, config: dupConfig } = parsedData.args;
          await duplicateContainer(name, dupConfig, peer);
          return; // Response is handled within the duplicateContainer function

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
          return; // No immediate response needed for streaming commands

        case 'killTerminal':
          console.log(`[INFO] Handling 'killTerminal' command for container: ${parsedData.args.containerId}`);
          handleKillTerminal(parsedData.args.containerId, peer);
          response = {
            success: true,
            message: `Terminal for container ${parsedData.args.containerId} killed`,
          };
          break;

        default:
          console.warn(`[WARN] Unknown command: ${parsedData.command}`);
          response = { error: 'Unknown command' };
      }

      // Send response if one was generated
      if (response) {
        console.log(`[DEBUG] Sending response to peer: ${JSON.stringify(response)}`);
        peer.write(JSON.stringify(response));
      }
    } catch (err) {
      console.error(`[ERROR] Failed to handle data from peer: ${err.message}`);
      peer.write(JSON.stringify({ error: err.message }));
    }
  });

  peer.on('close', () => {
    console.log('[INFO] Peer disconnected');
    connectedPeers.delete(peer);

    // Clean up any terminal session associated with this peer
    if (terminalSessions.has(peer)) {
      const session = terminalSessions.get(peer);
      console.log(`[INFO] Cleaning up terminal session for container: ${session.containerId}`);
      session.stream.end();
      peer.removeListener('data', session.onData);
      terminalSessions.delete(peer);
    }
  });
});

// Function to duplicate a container
async function duplicateContainer(name, config, peer) {
  try {
    // Remove non-essential fields from the configuration
    const sanitizedConfig = { ...config };
    delete sanitizedConfig.Id;
    delete sanitizedConfig.State;
    delete sanitizedConfig.Created;
    delete sanitizedConfig.NetworkSettings;
    delete sanitizedConfig.Mounts;
    delete sanitizedConfig.Path;
    delete sanitizedConfig.Args;
    delete sanitizedConfig.Image;

    // Ensure the container has a unique name
    const newName = name;
    const existingContainers = await docker.listContainers({ all: true });
    const nameExists = existingContainers.some(c => c.Names.includes(`/${newName}`));

    if (nameExists) {
      peer.write(JSON.stringify({ error: `Container name '${newName}' already exists.` }));
      return;
    }

    // Create a new container with the provided configuration
    const newContainer = await docker.createContainer({
      ...sanitizedConfig.Config,
      name: newName,
    });

    // Start the new container
    await newContainer.start();

    // Send success response
    peer.write(JSON.stringify({ success: true, message: `Container '${newName}' duplicated and started successfully.` }));

    // List containers again to update the client
    const containers = await docker.listContainers({ all: true });
    const update = { type: 'containers', data: containers };
    for (const connectedPeer of connectedPeers) {
      connectedPeer.write(JSON.stringify(update));
    }
  } catch (err) {
    console.error(`[ERROR] Failed to duplicate container: ${err.message}`);
    peer.write(JSON.stringify({ error: `Failed to duplicate container: ${err.message}` }));
  }
}

// Stream Docker events to all peers
docker.getEvents({}, (err, stream) => {
  if (err) {
    console.error(`[ERROR] Failed to get Docker events: ${err.message}`);
    return;
  }

  stream.on('data', async (chunk) => {
    try {
      const event = JSON.parse(chunk.toString());
      if (event.status === "undefined") return
      console.log(`[INFO] Docker event received: ${event.status} - ${event.id}`);

      // Get updated container list and broadcast it to all connected peers
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

// Collect and stream container stats
docker.listContainers({ all: true }, (err, containers) => {
  if (err) {
    console.error(`[ERROR] Failed to list containers for stats: ${err.message}`);
    return;
  }

  containers.forEach((containerInfo) => {
    const container = docker.getContainer(containerInfo.Id);
    container.stats({ stream: true }, (err, stream) => {
      if (err) {
        console.error(`[ERROR] Failed to get stats for container ${containerInfo.Id}: ${err.message}`);
        return;
      }

      stream.on('data', (data) => {
        try {
          const stats = JSON.parse(data.toString());
          const cpuUsage = calculateCPUPercent(stats);
          const memoryUsage = stats.memory_stats.usage;
          const networks = stats.networks;
          const ipAddress = networks ? Object.values(networks)[0].IPAddress : '-';

          const statsData = {
            id: containerInfo.Id,
            cpu: cpuUsage,
            memory: memoryUsage,
            ip: ipAddress,
          };

          // Broadcast stats to all connected peers
          for (const peer of connectedPeers) {
            peer.write(JSON.stringify({ type: 'stats', data: statsData }));
          }
        } catch (err) {
          console.error(`[ERROR] Failed to parse stats for container ${containerInfo.Id}: ${err.message}`);
        }
      });

      stream.on('error', (err) => {
        console.error(`[ERROR] Stats stream error for container ${containerInfo.Id}: ${err.message}`);
      });
    });
  });
});

// Function to calculate CPU usage percentage
function calculateCPUPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage.length;
  if (systemDelta > 0.0 && cpuDelta > 0.0) {
    return (cpuDelta / systemDelta) * cpuCount * 100.0;
  }
  return 0.0;
}

// Function to handle terminal sessions
async function handleTerminal(containerId, peer) {
  const container = docker.getContainer(containerId);

  try {
    const exec = await container.exec({
      Cmd: ['/bin/bash'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    console.log(`[INFO] Terminal session started for container: ${containerId}`);

    const onData = (input) => {
      try {
        const parsed = JSON.parse(input.toString());
        if (parsed.type === 'terminalInput' && parsed.data) {
          let inputData;
          if (parsed.encoding === 'base64') {
            inputData = Buffer.from(parsed.data, 'base64');
          } else {
            inputData = Buffer.from(parsed.data);
          }
          stream.write(inputData);
        }
      } catch (err) {
        console.error(`[ERROR] Failed to parse terminal input: ${err.message}`);
      }
    };

    peer.on('data', onData);

    // Store the session along with the onData listener
    terminalSessions.set(peer, { containerId, exec, stream, onData });

    stream.on('data', (chunk) => {
      const dataBase64 = chunk.toString('base64');
      peer.write(JSON.stringify({
        type: 'terminalOutput',
        containerId,
        data: dataBase64,
        encoding: 'base64',
      }));
    });

    peer.on('close', () => {
      console.log(`[INFO] Peer disconnected, ending terminal session for container: ${containerId}`);
      stream.end();
      terminalSessions.delete(peer);
      peer.removeListener('data', onData);
    });
  } catch (err) {
    console.error(`[ERROR] Failed to start terminal for container ${containerId}: ${err.message}`);
    peer.write(JSON.stringify({ error: `Failed to start terminal: ${err.message}` }));
  }
}

// Function to handle killing terminal sessions
function handleKillTerminal(containerId, peer) {
  const session = terminalSessions.get(peer);

  if (session && session.containerId === containerId) {
    console.log(`[INFO] Killing terminal session for container: ${containerId}`);

    // Close the stream and exec session
    session.stream.end();
    terminalSessions.delete(peer);

    // Remove the specific 'data' event listener for terminal input
    peer.removeListener('data', session.onData);

    console.log(`[INFO] Terminal session for container ${containerId} terminated`);
  } else {
    console.warn(`[WARN] No terminal session found for container: ${containerId}`);
  }
}

// Function to duplicate a container (already defined above)

// Stream Docker events to all peers (already defined above)

// Handle process termination
process.on('SIGINT', () => {
  console.log('[INFO] Server shutting down');
  swarm.destroy();
  process.exit();
});
