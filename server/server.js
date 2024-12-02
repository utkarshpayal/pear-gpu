// server.js

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

// Start listening or further implementation logic here
// Join the swarm with the generated topic
swarm.join(topic, { server: true, client: false });

// Handle incoming peer connections
swarm.on('connection', (peer) => {
  console.log('[INFO] Peer connected');
  connectedPeers.add(peer);

  peer.on('data', async (data) => {
    try {
      const parsedData = JSON.parse(data.toString());
      if (!(parsedData.command === 'stats' && Object.keys(parsedData.args).length === 0)) {
        console.log(`[DEBUG] Received data from peer: ${JSON.stringify(parsedData)}`);
      }
      let response;

      switch (parsedData.command) {
        case 'listContainers':
          console.log('[INFO] Handling \'listContainers\' command');
          try {
            const containers = await docker.listContainers({ all: true });

            const detailedContainers = await Promise.all(
              containers.map(async (container) => {
                try {
                  const details = await docker.getContainer(container.Id).inspect();

                  // Safely access the IP address
                  let ipAddress = 'No IP Assigned';
                  if (details.NetworkSettings && details.NetworkSettings.Networks) {
                    const networks = Object.values(details.NetworkSettings.Networks);
                    if (networks.length > 0 && networks[0].IPAddress) {
                      ipAddress = networks[0].IPAddress;
                    }
                  }

                  return { ...container, ipAddress }; // Add IP address to container data
                } catch (error) {
                  console.error(`[ERROR] Failed to inspect container ${container.Id}: ${error.message}`);
                  return { ...container, ipAddress: 'Error Retrieving IP' }; // Return partial data with error
                }
              })
            );

            response = { type: 'containers', data: detailedContainers };
          } catch (error) {
            console.error(`[ERROR] Failed to list containers: ${error.message}`);
            response = { error: 'Failed to list containers' };
          }
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
          console.log("MEMEMMEMEMEMEMEMEMMEME " + memoryInMB)

          await duplicateContainer(name, image, hostname, netmode, cpu, memoryInMB, dupConfig, peer);
          return; // Response is handled within the duplicateContainer function
        case 'dockerCommand':
          console.log(`[INFO] Executing Docker CLI command: ${parsedData.data}`);
          try {
            const exec = spawn('sh', ['-c', parsedData.data]);

            exec.stdout.on('data', (output) => {
              peer.write(
                JSON.stringify({
                  type: 'dockerOutput',
                  connectionId: parsedData.connectionId,
                  data: output.toString(),
                })
              );
            });

            exec.stderr.on('data', (error) => {
              peer.write(
                JSON.stringify({
                  type: 'dockerOutput',
                  connectionId: parsedData.connectionId,
                  data: `[ERROR] ${error.toString()}`,
                })
              );
            });

            exec.on('close', (code) => {
              peer.write(
                JSON.stringify({
                  type: 'dockerOutput',
                  connectionId: parsedData.connectionId,
                  data: `[INFO] Command exited with code ${code}\n`,
                })
              );
            });
          } catch (error) {
            peer.write(JSON.stringify({ error: `Failed to execute command: ${error.message}` }));
          }
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

        case 'restartContainer':
          console.log(`[INFO] Handling 'restartContainer' command for container: ${parsedData.args.id}`);
          await docker.getContainer(parsedData.args.id).restart();
          response = { success: true, message: `Container ${parsedData.args.id} restarted` };
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
          // console.warn(`[WARN] Unknown command: ${parsedData.command}`);
          // response = { error: 'Unknown command' };
          return
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

  peer.on('error', (err) => {
    console.error(`[ERROR] Peer connection error: ${err.message}`);
    cleanupPeer(peer);
  });

  peer.on('close', () => {
    console.log('[INFO] Peer disconnected');
    connectedPeers.delete(peer);
    cleanupPeer(peer)

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

// Helper function to handle peer cleanup
function cleanupPeer(peer) {
  connectedPeers.delete(peer);

  if (terminalSessions.has(peer)) {
    const session = terminalSessions.get(peer);
    console.log(`[INFO] Cleaning up terminal session for container: ${session.containerId}`);
    session.stream.end();
    peer.removeListener('data', session.onData);
    terminalSessions.delete(peer);
  }
}

// Function to duplicate a container
async function duplicateContainer(name, image, hostname, netmode, cpu, memory, config, peer) {
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
    delete sanitizedConfig.Hostname;
    delete sanitizedConfig.CpuCount;
    delete sanitizedConfig.Memory;
    delete sanitizedConfig.CpuShares;
    delete sanitizedConfig.CpusetCpus;



    // Ensure the container has a unique name
    const newName = name;
    const existingContainers = await docker.listContainers({ all: true });
    const nameExists = existingContainers.some(c => c.Names.includes(`/${newName}`));

    if (nameExists) {
      peer.write(JSON.stringify({ error: `Container name '${newName}' already exists.` }));
      return;
    }


    const cpusetCpus = Array.from({ length: cpu }, (_, i) => i).join(",");
    const nanoCpus = cpu * 1e9;

    // Create a new container with the provided configuration
    const newContainer = await docker.createContainer({
      ...sanitizedConfig.Config, // General configuration
      name: newName,            // Container name
      Hostname: hostname,       // Hostname for the container
      Image: image,             // Container image
      HostConfig: {             // Host-specific configurations
        CpusetCpus: cpusetCpus.toString(),          // Number of CPUs
        NanoCpus: nanoCpus,     // Restrict CPU time (e.g., 4 cores = 4e9 nanoseconds)
        Memory: Number(memory),         // Memory limit in bytes
        MemoryReservation: Number(memory),         // Memory limit in bytes

        NetworkMode: netmode.toString(),   // Network mode
      },
    });
    // Start the new container
    await newContainer.start();

    // Send success response to the requesting peer
    peer.write(JSON.stringify({ success: true, message: `Container '${newName}' duplicated and started successfully.` }));

    // Get the updated list of containers
    const containers = await docker.listContainers({ all: true });
    const update = { type: 'containers', data: containers };

    // Broadcast the updated container list to all connected peers
    for (const connectedPeer of connectedPeers) {
      connectedPeer.write(JSON.stringify(update));
    }

    // Start streaming stats for the new container
    const newContainerInfo = containers.find(c => c.Names.includes(`/${newName}`));
    if (newContainerInfo) {
      streamContainerStats(newContainerInfo);
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
docker.listContainers({ all: true }, async (err, containers) => {
  if (err) {
    console.error(`[ERROR] Failed to list containers for stats: ${err.message}`);
    return;
  }

  // Iterate over all containers
  containers.forEach((containerInfo) => {
    const container = docker.getContainer(containerInfo.Id);

    // Use the same logic as listContainers to pre-inspect and extract the IP address
    container.inspect((inspectErr, details) => {
      let ipAddress = 'No IP Assigned'; // Default fallback

      if (!inspectErr && details.NetworkSettings && details.NetworkSettings.Networks) {
        const networks = Object.values(details.NetworkSettings.Networks);
        if (networks.length > 0 && networks[0].IPAddress) {
          ipAddress = networks[0].IPAddress; // Use the first network's IP
        }
      }

      // Start streaming container stats
      container.stats({ stream: true }, (statsErr, stream) => {
        if (statsErr) {
          console.error(`[ERROR] Failed to get stats for container ${containerInfo.Id}: ${statsErr.message}`);
          return;
        }

        stream.on('data', (data) => {
          try {
            const stats = JSON.parse(data.toString());
            const cpuUsage = calculateCPUPercent(stats);
            const memoryUsage = stats.memory_stats.usage || 0; // Default to 0 if undefined

            const statsData = {
              id: containerInfo.Id,
              cpu: cpuUsage,
              memory: memoryUsage,
              ip: ipAddress, // Use the pre-inspected IP address
            };

            // Broadcast stats to all connected peers
            for (const peer of connectedPeers) {
              peer.write(JSON.stringify({ type: 'stats', data: statsData }));
            }
          } catch (parseErr) {
            // console.error(`[ERROR] Failed to parse stats for container ${containerInfo.Id}: ${parseErr.message}`);
          }
        });

        stream.on('error', (streamErr) => {
          // console.error(`[ERROR] Stats stream error for container ${containerInfo.Id}: ${streamErr.message}`);
        });

        stream.on('close', () => {
          // console.log(`[INFO] Stats stream closed for container ${containerInfo.Id}`);
        });
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

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    container.modem.demuxStream(stream, stdout, stderr);

    const onData = (input) => {
      try {
        const parsed = JSON.parse(input.toString());
        if (parsed.type === 'terminalInput' && parsed.data) {
          const inputData = parsed.encoding === 'base64'
            ? Buffer.from(parsed.data, 'base64')
            : Buffer.from(parsed.data);
          stream.write(inputData);
        }
      } catch (err) {
        console.error(`[ERROR] Failed to parse terminal input: ${err.message}`);
      }
    };

    peer.on('data', onData);
    terminalSessions.set(peer, { containerId, exec, stream, onData });

    stdout.on('data', (chunk) => {
      peer.write(JSON.stringify({
        type: 'terminalOutput',
        containerId,
        data: chunk.toString('base64'),
        encoding: 'base64',
      }));
    });

    stderr.on('data', (chunk) => {
      peer.write(JSON.stringify({
        type: 'terminalErrorOutput',
        containerId,
        data: chunk.toString('base64'),
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

function streamContainerStats(containerInfo) {
  const container = docker.getContainer(containerInfo.Id);

  // Use the same logic as listContainers to get the IP address
  container.inspect((inspectErr, details) => {
    let ipAddress = 'No IP Assigned'; // Default IP address fallback

    if (inspectErr) {
      console.error(`[ERROR] Failed to inspect container ${containerInfo.Id}: ${inspectErr.message}`);
    } else if (details.NetworkSettings && details.NetworkSettings.Networks) {
      const networks = Object.values(details.NetworkSettings.Networks);
      if (networks.length > 0 && networks[0].IPAddress) {
        ipAddress = networks[0].IPAddress; // Retrieve the first network's IP address
      }
    }

    // Start streaming container stats
    container.stats({ stream: true }, (statsErr, stream) => {
      if (statsErr) {
        console.error(`[ERROR] Failed to get stats for container ${containerInfo.Id}: ${statsErr.message}`);
        return;
      }

      stream.on('data', (data) => {
        try {
          const stats = JSON.parse(data.toString());
          const cpuUsage = calculateCPUPercent(stats);
          const memoryUsage = stats.memory_stats.usage || 0; // Default to 0 if undefined

          // Use the extracted IP address in the stats data
          const statsData = {
            id: containerInfo.Id,
            cpu: cpuUsage,
            memory: memoryUsage,
            ip: ipAddress, // Use the IP address retrieved during inspection
          };

          // Broadcast stats to all connected peers
          for (const peer of connectedPeers) {
            peer.write(JSON.stringify({ type: 'stats', data: statsData }));
          }
        } catch (parseErr) {
          console.error(`[ERROR] Failed to parse stats for container ${containerInfo.Id}: ${parseErr.message}`);
        }
      });

      stream.on('error', (streamErr) => {
        console.error(`[ERROR] Stats stream error for container ${containerInfo.Id}: ${streamErr.message}`);
      });

      stream.on('close', () => {
        console.log(`[INFO] Stats stream closed for container ${containerInfo.Id}`);
      });
    });
  });
}



// Handle process termination
process.on('SIGINT', () => {
  console.log('[INFO] Server shutting down');
  swarm.destroy();
  process.exit();
});
