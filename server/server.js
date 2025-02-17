// server.js

import Hyperswarm from 'hyperswarm';
import Docker from 'dockerode';
import crypto from 'hypercore-crypto';
import { PassThrough } from 'stream';
import os from "os";
import fs from 'fs';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
// Load environment variables from .env file
dotenv.config();
 let gpuId;
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
const args = process.argv.slice(2);
let start = false; // Initially false, will be set to true based on condition 
const timeArgIndex = args.findIndex(arg => arg === '--time');
console.log("time ", timeArgIndex)
const isNewKey = args.includes('--new');
let timeInSeconds = 0;

if (timeArgIndex !== -1 && args[timeArgIndex + 1]) {
  timeInSeconds = parseInt(args[timeArgIndex + 1], 10);

  if (isNaN(timeInSeconds) || timeInSeconds <= 0) {
    console.log('[ERROR] Invalid time argument. Please provide a valid number in seconds.');
    process.exit(1);
  }
}

const startTimer = () => {
  if (start) {
    console.log(`[INFO] Timer started. Server will shut down in ${timeInSeconds} seconds.`);

    setTimeout(() => {
      console.log('[INFO] Time limit reached. Shutting down server.');
      swarm.destroy();
      process.exit(0);
    }, timeInSeconds * 1000);
  }
};




let keyHex;
if (isNewKey) {
  const newKey = generateNewKey();
  keyHex = newKey.toString('hex');

  if (fs.existsSync('.env')) {
    console.log('[INFO] Updating existing SERVER_KEY in .env...');
    const envContent = fs.readFileSync('.env', 'utf8');
    const updatedEnv = envContent
    .split('\n') 
    .filter((line) => !line.startsWith('SERVER_KEY=')) 
    .concat(`SERVER_KEY=${keyHex}`) 
    .join('\n') 
    .trim(); 
  fs.writeFileSync('.env', `${updatedEnv}\n`);
  } else {
    console.log('[INFO] .env file not found. Creating a new one...');
    fs.writeFileSync('.env', `SERVER_KEY=${keyHex}\n`);
  }

  console.log('[INFO] New SERVER_KEY saved to .env.');
} else {
  keyHex = process.env.SERVER_KEY;

  if (!keyHex) {
    console.log('[INFO] No SERVER_KEY found in .env. Generating a new one...');
    const newKey = generateNewKey();
    keyHex = newKey.toString('hex');

    if (fs.existsSync('.env')) {
      const envContent = fs.readFileSync('.env', 'utf8');

      // Replace SERVER_KEY if it exists, or add it if it doesn't
      const updatedEnv = envContent.includes('SERVER_KEY=')
        ? envContent.replace(/SERVER_KEY=.*/, `SERVER_KEY=${keyHex}`)
        : `${envContent.trim()}\nSERVER_KEY=${keyHex}\n`;

      fs.writeFileSync('.env', updatedEnv);
    } else {
      fs.writeFileSync('.env', `SERVER_KEY=${keyHex}\n`);
    }

    console.log('[INFO] New SERVER_KEY saved to .env.');
  } else {
    console.log('[INFO] SERVER_KEY loaded from .env.');
  }
}

// Convert the keyHex to a Buffer
const topic = Buffer.from(keyHex, 'hex');

const key = `${topic.toString('hex')}`;
const generateToken = (key) => {
  const payload = {
    key,
    timeInSeconds
  };
  
  // Generate and return the token
  return jwt.sign(payload, 'secret', { expiresIn: '1h' });  
}
const hexcode = generateToken(key);
const response = await fetch("http://localhost:8282/add-gpu", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    hexcode: hexcode,
  }),
  
}
)


const responseData = await response.json(); // Await the response data here
console.log("Click on this link to add GPU", responseData.url)


console.log(`[INFO] Server started `);
  // with topic: ${topic.toString('hex')}`);

const fetchGpus = async () => {
  try {
    const response = await fetch("http://localhost:8282/gpus");

    // Check if the response is successful (status 200-299)
    if (!response.ok) {
      throw new Error("Failed to fetch GPUs");
    }

    const data = await response.json();
     const gpu = data.find(gpu => gpu.key === `${topic.toString('hex')}`);
     gpuId = gpu.id;
      } catch (err) {
    console.log(err);
  } 
};

fetchGpus();





  
















// Function to add connection time to the database
// Function to add connection time to a specific GPU in the database
const addConnectionTimeToGpu = async (gpuId, peerId, connectionTime) => {
  console.log(gpuId,peerId.toString('hex'),connectionTime)
  try {
    const response = await fetch(`http://localhost:8282/gpus/${gpuId}/connection-time`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        peerId: peerId.toString('hex'),
        connectionTime: connectionTime,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to save connection time');
    }

    const result = await response.json();
    console.log('Connection time saved:', result);
  } catch (err) {
    console.error('Error saving connection time:', err);
  }
};

// Handle incoming peer connections
swarm.on('connection', (peer) => {
  console.log('[INFO] Peer connected');

  
  startTimer();
  // Start timer or any additional logic for the connection
  start = true;
  connectedPeers.add(peer);
  startTimer();
});

// Start listening or further implementation logic here
// Join the swarm with the generated topic
swarm.join(topic, { server: true, client: false });

// Handle incoming peer connections
swarm.on('connection', (peer) => {
  const connectionTime = new Date().toISOString(); // Capture the connection time
  console.log('[INFO] Peer connected');
  start = true;

  connectedPeers.add(peer);
  
  // Assuming you have the GPU ID available (from your logic)
  addConnectionTimeToGpu(gpuId, peer.publicKey, connectionTime);  startTimer();


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
        case 'dockerCommand':
          console.log(`[INFO] Handling 'dockerCommand' with data: ${parsedData.data}`);

          try {
            const command = parsedData.data.split(' '); // Split the command into executable and args
            const executable = command[0];
            const args = command.slice(1);

            const childProcess = spawn(executable, args);

            let response = {
              type: 'dockerOutput',
              connectionId: parsedData.connectionId,
              data: '',
            };

            // Stream stdout to the peer
            childProcess.stdout.on('data', (data) => {
              console.log(`[DEBUG] Command stdout: ${data.toString()}`);
              peer.write(
                JSON.stringify({
                  ...response,
                  data: data.toString('base64'),
                  encoding: 'base64',
                })
              );
            });

            // Stream stderr to the peer
            childProcess.stderr.on('data', (data) => {
              console.error(`[ERROR] Command stderr: ${data.toString()}`);
              peer.write(
                JSON.stringify({
                  ...response,
                  data: `[ERROR] ${data.toString('base64')}`,
                  encoding: 'base64',
                })
              );
            });

            // Handle command exit
            childProcess.on('close', (code) => {
              const exitMessage = `[INFO] Command exited with code ${code}`;
              console.log(exitMessage);
              peer.write(
                JSON.stringify({
                  ...response,
                  data: exitMessage,
                })
              );
            });
          } catch (error) {
            console.error(`[ERROR] Command execution failed: ${error.message}`);
            peer.write(
              JSON.stringify({
                type: 'dockerOutput',
                connectionId: parsedData.connectionId,
                data: `[ERROR] Failed to execute command: ${error.message}`,
              })
            );
          }
          break;


        case 'logs':
          console.log(`[INFO] Handling 'logs' command for container: ${parsedData.args.id}`);
          const logsContainer = docker.getContainer(parsedData.args.id);
          const logsStream = await logsContainer.logs({
            stdout: true,
            stderr: true,
            tail: 100, // Fetch the last 100 log lines
            follow: true, // Stream live logs
          });

          logsStream.on('data', (chunk) => {
            peer.write(
              JSON.stringify({
                type: 'logs',
                data: chunk.toString('base64'), // Send base64 encoded logs
              })
            );
          });

          logsStream.on('end', () => {
            console.log(`[INFO] Log stream ended for container: ${parsedData.args.id}`);
          });

          logsStream.on('error', (err) => {
            console.error(`[ERROR] Log stream error for container ${parsedData.args.id}: ${err.message}`);
            peer.write(JSON.stringify({ error: `Log stream error: ${err.message}` }));
          });

          break;

        case 'duplicateContainer':
          console.log('[INFO] Handling \'duplicateContainer\' command');
          const { name, image, hostname, netmode, cpu, memory, config: dupConfig } = parsedData.args;
          const memoryInMB = memory * 1024 * 1024;
          console.log("MEMEMMEMEMEMEMEMEMMEME " + memoryInMB)

          await duplicateContainer(name, image, hostname, netmode, cpu, memoryInMB, dupConfig, peer);
          return; // Response is handled within the duplicateContainer function
        case 'startContainer':
          console.log(`${JSON.stringify(response)}`, "manju")
          console.log(`[INFO] Handling 'startContainer' command for container: ${parsedData.args.id}`);
          await docker.getContainer(parsedData.args.id).start();
          response = { success: true, message: `Container ${parsedData.args.id} started` };
          break;
          // case 'allStats':
          //   await handleallStatsRequest(peer);
          //   return; // No further response needed
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

          case 'deployContainer':
            console.log('[INFO] Handling "deployContainer" command');
            const { containerName, image: imageToDeploy, ports = [], volumes = [], env = [] } = parsedData.args;

            try {
              // Validate and sanitize container name
              if (!containerName || typeof containerName !== 'string') {
                throw new Error('Invalid or missing container name.');
              }

              // Ensure the name is alphanumeric with optional dashes/underscores
              if (!/^[a-zA-Z0-9-_]+$/.test(containerName)) {
                throw new Error('Container name must be alphanumeric and may include dashes or underscores.');
              }

              // Validate and sanitize image
              if (!imageToDeploy || typeof imageToDeploy !== 'string') {
                throw new Error('Invalid or missing Docker image.');
              }

              // Validate and sanitize ports
              const validPorts = ports.filter((port) => {
                if (typeof port === 'string' && /^\d+\/(tcp|udp)$/.test(port)) {
                  return true;
                } else {
                  console.warn(`[WARN] Invalid port entry skipped: ${port}`);
                  return false;
                }
              });

              // Validate and sanitize volumes
              const validVolumes = volumes.filter((volume) => {
                if (typeof volume === 'string' && volume.includes(':')) {
                  return true;
                } else {
                  console.warn(`[WARN] Invalid volume entry skipped: ${volume}`);
                  return false;
                }
              });

              // Validate and sanitize environment variables
              const validEnv = env
                .map(({ name, value }) => {
                  if (name && value) {
                    return `${name}=${value}`;
                  } else {
                    console.warn(`[WARN] Invalid environment variable skipped: name=${name}, value=${value}`);
                    return null;
                  }
                })
                .filter(Boolean);

              console.log(`[INFO] Pulling Docker image "${imageToDeploy}"`);

              // Pull the Docker image
              const pullStream = await docker.pull(imageToDeploy);
              await new Promise((resolve, reject) => {
                docker.modem.followProgress(pullStream, (err) => (err ? reject(err) : resolve()));
              });

              console.log(`[INFO] Image "${imageToDeploy}" pulled successfully`);

              // Configure container creation settings
              const hostConfig = {
                PortBindings: {},
                Binds: validVolumes, // Use validated volumes in Docker's expected format
                NetworkMode: 'bridge', // Set the network mode to bridge
              };
              validPorts.forEach((port) => {
                const [containerPort, protocol] = port.split('/');
                hostConfig.PortBindings[`${containerPort}/${protocol}`] = [{ HostPort: containerPort }];
              });

              // Create and start the container with a custom name
              console.log('[INFO] Creating the container...');
              const container = await docker.createContainer({
                name: containerName, // Include the container name
                Image: imageToDeploy,
                Env: validEnv,
                HostConfig: hostConfig,
              });

              console.log('[INFO] Starting the container...');
              await container.start();

              console.log(`[INFO] Container "${containerName}" deployed successfully from image "${imageToDeploy}"`);

              // Respond with success message
              peer.write(
                JSON.stringify({
                  success: true,
                  message: `Container "${containerName}" deployed successfully from image "${imageToDeploy}"`,
                })
              );

              // Update all peers with the latest container list
              const containers = await docker.listContainers({ all: true });
              const update = { type: 'containers', data: containers };

              for (const connectedPeer of connectedPeers) {
                connectedPeer.write(JSON.stringify(update));
              }
            } catch (err) {
              console.error(`[ERROR] Failed to deploy container: ${err.message}`);
              peer.write(
                JSON.stringify({
                  error: `Failed to deploy container: ${err.message}`,
                })
              );
            }
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
    });
  });
});

// Function to calculate CPU usage percentage
function calculateCPUPercent(stats) {
  try {
    if (!stats || typeof stats !== 'object') {
      throw new Error('Invalid stats object');
    }

    const cpuDelta = 
      stats?.cpu_stats?.cpu_usage?.total_usage - 
      stats?.precpu_stats?.cpu_usage?.total_usage;

    const systemDelta = 
      (stats?.cpu_stats?.system_cpu_usage || 0) - 
      (stats?.precpu_stats?.system_cpu_usage || 0);

    const cpuCount = 
      stats?.cpu_stats?.online_cpus || 
      stats?.cpu_stats?.cpu_usage?.percpu_usage?.length || 
      0;

    if (!Number.isFinite(cpuDelta)) {
      throw new Error('Invalid CPU delta');
    }

    if (!Number.isFinite(systemDelta)) {
      throw new Error('Invalid system delta');
    }

    if (cpuCount === 0) {
      // console.warn('[WARNING] CPU count is zero or undefined.');
      return 0.0;
    }

    if (systemDelta > 0 && cpuDelta > 0) {
      return (cpuDelta / systemDelta) * cpuCount * 100.0;
    }

    return 0.0;
  } catch (err) {
    console.error(`[ERROR] Failed to calculate CPU percent: ${err.message}`);
    return 0.0;
  }
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

async function collectContainerStats(containerStats) {
  const currentContainers = await docker.listContainers({ all: true });
  const currentIds = currentContainers.map((c) => c.Id);

  // Collect stats for all containers, including newly added ones
  for (const containerInfo of currentContainers) {
    if (!containerStats[containerInfo.Id]) {
      console.log(`[INFO] Found new container: ${containerInfo.Names[0]?.replace(/^\//, '')}`);
      containerStats[containerInfo.Id] = await initializeContainerStats(containerInfo);
    }
  }

  // Remove containers that no longer exist
  Object.keys(containerStats).forEach((id) => {
    if (!currentIds.includes(id)) {
      console.log(`[INFO] Removing stats tracking for container: ${id}`);
      delete containerStats[id];
    }
  });

  return containerStats;
}

async function initializeContainerStats(containerInfo) {
  const container = docker.getContainer(containerInfo.Id);

  // Inspect container for IP address
  let ipAddress = 'No IP Assigned';
  try {
    const details = await container.inspect();
    const networks = details.NetworkSettings?.Networks || {};
    ipAddress = Object.values(networks)[0]?.IPAddress || 'No IP Assigned';
  } catch (err) {
    console.error(`[ERROR] Failed to inspect container ${containerInfo.Id}: ${err.message}`);
  }

  const statsData = {
    id: containerInfo.Id,
    name: containerInfo.Names[0]?.replace(/^\//, '') || 'Unknown',
    cpu: 0,
    memory: 0,
    ip: ipAddress,
  };

  // Start streaming stats for the container
  try {
    const statsStream = await container?.stats?.({ stream: true });
    
    if (!statsStream) {
      console.error(`[ERROR] Stats stream is undefined or null for container ${containerInfo?.Id || 'unknown'}`);
      return statsData;
    }
  
    statsStream.on('data', (data) => {
      try {
        const dataString = data?.toString();
        if (!dataString) {
          console.warn(`[WARNING] Received null or undefined data for container ${containerInfo?.Id || 'unknown'}`);
          return;
        }
        const stats = JSON.parse(dataString);  
        statsData.cpu = calculateCPUPercent(stats) || 0; // Fallback to 0 if undefined
        statsData.memory = stats?.memory_stats?.usage || 0; // Fallback to 0 if undefined
      } catch (err) {
        console.error(`[ERROR] Failed to parse stats for container ${containerInfo?.Id || 'unknown'}: ${err.message}`);
      }
    });
  
    statsStream.on('error', (err) => {
      console.error(`[ERROR] Stats stream error for container ${containerInfo?.Id || 'unknown'}: ${err?.message || 'No message'}`);
    });
  
    statsStream.on('close', () => {
      console.log(`[INFO] Stats stream closed for container ${containerInfo?.Id || 'unknown'}`);
    });
  } catch (err) {
    console.error(`[ERROR] Failed to start stats stream for container ${containerInfo?.Id || 'unknown'}: ${err?.message || 'No message'}`);
  }
  
  return statsData;
  
}

async function handleStatsBroadcast() {
  const containerStats = {};

  // Periodically update stats and broadcast
  setInterval(async () => {
    await collectContainerStats(containerStats);
    const aggregatedStats = Object.values(containerStats);
    const response = { type: 'allStats', data: aggregatedStats };

    for (const peer of connectedPeers) {
      peer.write(JSON.stringify(response));
    }
  }, 1000); // Send stats every 500ms
}

// Start the stats broadcast
handleStatsBroadcast();



// Handle process termination
process.on('SIGINT', () => {
  console.log('[INFO] Server shutting down');
  
  swarm.destroy();
  process.exit();
});