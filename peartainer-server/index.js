/** @typedef {import('pear-interface')} Pear */
import Pear from 'pear-interface';
import Hyperswarm from 'hyperswarm';
import Docker from 'dockerode';
import crypto from 'hypercore-crypto';
import { PassThrough } from 'stream';
import os from "os";
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const docker = new Docker({
  socketPath: os.platform() === "win32" ? '//./pipe/dockerDesktopLinuxEngine' : '/var/run/docker.sock',
});
const swarm = new Hyperswarm();
const connectedPeers = new Set();
const terminalSessions = new Map(); // Map to track terminal sessions per peer

// Function to generate a new key
function generateNewKey() {
  const newKey = crypto.randomBytes(32);
  fs.appendFileSync('.env', `SERVER_KEY=${newKey.toString('hex')}\n`, { flag: 'a' });
  return newKey;
}

// Load or generate the topic key
let keyHex = process.env.SERVER_KEY;
if (!keyHex) {
  console.log('[INFO] No SERVER_KEY found in .env. Generating a new one...');
  const newKey = generateNewKey();
  keyHex = newKey.toString('hex');
} else {
  console.log('[INFO] SERVER_KEY loaded from .env.');
}

// Convert the keyHex to a Buffer
const topic = Buffer.from(keyHex, 'hex');

console.log(`[INFO] Server started with topic: ${topic.toString('hex')}`);

// Display Pear versions
(async () => {
  try {
    console.log('Pear terminal application running');
    const { versions } = Pear;
    console.log('[INFO] Fetching Pear versions...');
    const pearVersions = await versions();
    console.log('[INFO] Pear Versions:', pearVersions);
  } catch (err) {
    console.error('[ERROR] Unable to fetch Pear versions:', err.message);
  }
})();

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
          const { name, image, hostname, netmode, cpu, memory, config: dupConfig } = parsedData.args;
          const memoryInMB = memory * 1024 * 1024;
          await duplicateContainer(name, image, hostname, netmode, cpu, memoryInMB, dupConfig, peer);
          return;

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
          return;

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
          return;
      }

      if (response) {
        console.log(`[DEBUG] Sending response to peer: ${JSON.stringify(response)}`);
        peer.write(JSON.stringify(response));
      }
    } catch (err) {
      console.error(`[ERROR] Failed to handle data from peer: ${err.message}`);
      peer.write(JSON.stringify({ error: err.message }));
    }
  });

  peer.on('error', (err) => {
    console.error(`[ERROR] Peer connection error: ${err.message}`);
    cleanupPeer(peer);
  });

  peer.on('close', () => {
    console.log('[INFO] Peer disconnected');
    connectedPeers.delete(peer);
    cleanupPeer(peer);
  });
});

// Helper function to handle peer cleanup
function cleanupPeer(peer) {
  if (terminalSessions.has(peer)) {
    const session = terminalSessions.get(peer);
    console.log(`[INFO] Cleaning up terminal session for container: ${session.containerId}`);
    session.stream.end();
    peer.removeListener('data', session.onData);
    terminalSessions.delete(peer);
  }
  connectedPeers.delete(peer);
}

// Function to duplicate a container
async function duplicateContainer(name, image, hostname, netmode, cpu, memory, config, peer) {
  try {
    const sanitizedConfig = { ...config };
    delete sanitizedConfig.Id;
    delete sanitizedConfig.State;
    delete sanitizedConfig.Created;
    delete sanitizedConfig.NetworkSettings;
    delete sanitizedConfig.Mounts;
    delete sanitizedConfig.Path;
    delete sanitizedConfig.Args;

    const existingContainers = await docker.listContainers({ all: true });
    const nameExists = existingContainers.some(c => c.Names.includes(`/${name}`));
    if (nameExists) {
      peer.write(JSON.stringify({ error: `Container name '${name}' already exists.` }));
      return;
    }

    const cpusetCpus = Array.from({ length: cpu }, (_, i) => i).join(",");
    const nanoCpus = cpu * 1e9;

    const newContainer = await docker.createContainer({
      ...sanitizedConfig.Config,
      name,
      HostConfig: {
        CpusetCpus: cpusetCpus,
        NanoCpus: nanoCpus,
        Memory: memory,
      },
    });
    await newContainer.start();
    peer.write(JSON.stringify({ success: true, message: `Container '${name}' duplicated successfully.` }));
  } catch (err) {
    console.error(`[ERROR] Failed to duplicate container: ${err.message}`);
    peer.write(JSON.stringify({ error: `Failed to duplicate container: ${err.message}` }));
  }
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

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    container.modem.demuxStream(stream, stdout, stderr);

    stdout.on('data', (chunk) => {
      peer.write(JSON.stringify({
        type: 'terminalOutput',
        data: chunk.toString('base64'),
        encoding: 'base64',
      }));
    });

    stderr.on('data', (chunk) => {
      peer.write(JSON.stringify({
        type: 'terminalErrorOutput',
        data: chunk.toString('base64'),
        encoding: 'base64',
      }));
    });

    peer.on('data', (input) => {
      try {
        const parsed = JSON.parse(input.toString());
        if (parsed.type === 'terminalInput') {
          const inputData = Buffer.from(parsed.data, 'base64');
          stream.write(inputData);
        }
      } catch (err) {
        console.error(`[ERROR] Failed to process terminal input: ${err.message}`);
      }
    });

    peer.on('close', () => {
      stream.end();
    });

  } catch (err) {
    console.error(`[ERROR] Failed to start terminal for container: ${err.message}`);
  }
}

// Function to stream container stats
function streamContainerStats(containerInfo) {
  const container = docker.getContainer(containerInfo.Id);

  container.stats({ stream: true }, (err, stream) => {
    if (err) {
      console.error(`[ERROR] Failed to stream stats: ${err.message}`);
      return;
    }

    stream.on('data', (data) => {
      try {
        const stats = JSON.parse(data.toString());
        const cpuUsage = calculateCPUPercent(stats);
        const memoryUsage = stats.memory_stats.usage;

        const statsData = {
          id: containerInfo.Id,
          cpu: cpuUsage,
          memory: memoryUsage,
        };

        connectedPeers.forEach((peer) => {
          peer.write(JSON.stringify({ type: 'stats', data: statsData }));
        });
      } catch (err) {
        console.error(`[ERROR] Failed to process stats data: ${err.message}`);
      }
    });

    stream.on('error', (err) => {
      console.error(`[ERROR] Stats stream error: ${err.message}`);
    });
  });
}

// Function to calculate CPU usage percentage
function calculateCPUPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage.length;

  if (systemDelta > 0 && cpuDelta > 0) {
    return (cpuDelta / systemDelta) * cpuCount * 100.0;
  }
  return 0.0;
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('[INFO] Server shutting down');
  swarm.destroy();
  process.exit();
});
