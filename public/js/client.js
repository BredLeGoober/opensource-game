const overlay = document.getElementById('overlay');
const startButton = document.getElementById('startButton');
const usernameInput = document.getElementById('username');
const modeSelect = document.getElementById('mode');
const chat = document.getElementById('chat');
const chatInput = document.getElementById('chatInput');
const chatButton = document.getElementById('chatButton');
const statusLabel = document.getElementById('status');
const gameModeLabel = document.getElementById('gameMode');
const playerNameLabel = document.getElementById('playerName');
const actionToggle = document.getElementById('actionToggle');
const mobileControls = document.getElementById('mobileControls');

const savedName = localStorage.getItem('blocktopiaName');
if (savedName) usernameInput.value = savedName;
const moveForwardBtn = document.getElementById('moveForward');
const moveBackwardBtn = document.getElementById('moveBackward');
const moveLeftBtn = document.getElementById('moveLeft');
const moveRightBtn = document.getElementById('moveRight');
const jumpBtn = document.getElementById('jump');

let socket = null;
let isMultiplayer = false;
let isStarted = false;
let currentAction = 'place';
let canJump = false;
let velocityY = 0;
const keys = {};
const blockData = {};
const blockMeshes = {};
const remotePlayers = {};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.HemisphereLight(0xcce0ff, 0x444422, 1.2);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1);
sunLight.position.set(10, 20, 10);
scene.add(sunLight);

const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshBasicMaterial({ color: 0x4e7a60, opacity: 0.12, transparent: true })
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = 0;
scene.add(groundPlane);

const localPlayer = {
  id: 'local',
  name: 'Guest',
  x: 0,
  y: 5,
  z: 0,
  rotation: { x: 0, y: 0 },
  mesh: null
};

function terrainHeight(x, z) {
  return Math.max(0, Math.round(Math.sin(x * 0.24) * 2 + Math.cos(z * 0.18) * 2 + 3));
}

function terrainColor(y, height) {
  if (y === 0) return 0x5d4037;
  if (y === height) return 0x4caf50;
  if (y > height - 2) return 0x8d5524;
  return 0x7d7d7d;
}

function worldKey(x, y, z) {
  return `${x},${y},${z}`;
}

function addBlock(x, y, z, color = 0xffcc00) {
  const key = worldKey(x, y, z);
  if (blockData[key]) return;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
  blockData[key] = { x, y, z, color };
  blockMeshes[key] = mesh;
}

function removeBlock(key) {
  if (!blockData[key]) return;
  scene.remove(blockMeshes[key]);
  delete blockMeshes[key];
  delete blockData[key];
}

function addPlayerMesh(id, player) {
  if (remotePlayers[id]) return;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff5252 })
  );
  mesh.position.set(player.x, player.y, player.z);
  scene.add(mesh);
  remotePlayers[id] = { mesh, name: player.name || 'Guest' };
}

function updatePlayerMesh(id, player) {
  if (!remotePlayers[id]) return;
  remotePlayers[id].mesh.position.set(player.x, player.y, player.z);
}

function removePlayerMesh(id) {
  if (!remotePlayers[id]) return;
  scene.remove(remotePlayers[id].mesh);
  delete remotePlayers[id];
}

function generateTerrain(radius = 22) {
  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      const height = terrainHeight(x, z);
      for (let y = 0; y <= height; y += 1) {
        addBlock(x, y, z, terrainColor(y, height));
      }
    }
  }
}

function spawnLocalPlayer() {
  if (localPlayer.mesh) scene.remove(localPlayer.mesh);
  localPlayer.mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x2196f3 })
  );
  scene.add(localPlayer.mesh);
  localPlayer.mesh.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
}

function setStatus(text) {
  statusLabel.textContent = text;
}

function addChatMessage(name, message) {
  const item = document.createElement('div');
  item.textContent = `${name}: ${message}`;
  chat.appendChild(item);
  chat.scrollTop = chat.scrollHeight;
}

function updateUI() {
  playerNameLabel.textContent = localPlayer.name;
  gameModeLabel.textContent = `Mode: ${isMultiplayer ? 'Multiplayer' : 'Singleplayer'}`;
  chatInput.disabled = !isStarted;
  chatButton.disabled = !isStarted;
  mobileControls.style.display = 'flex';
}

function raycastBlock() {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = raycaster.intersectObjects(Object.values(blockMeshes));
  return intersects.length > 0 ? intersects[0] : null;
}

function handleAction() {
  const hit = raycastBlock();
  if (!hit) return;
  const mesh = hit.object;
  const blockX = Math.round(mesh.position.x - 0.5);
  const blockY = Math.round(mesh.position.y - 0.5);
  const blockZ = Math.round(mesh.position.z - 0.5);

  if (currentAction === 'break') {
    const key = worldKey(blockX, blockY, blockZ);
    if (isMultiplayer && socket && socket.connected) socket.emit('breakBlock', { pos: key });
    removeBlock(key);
    return;
  }

  const normal = hit.face.normal;
  const placeX = blockX + Math.round(normal.x);
  const placeY = blockY + Math.round(normal.y);
  const placeZ = blockZ + Math.round(normal.z);
  const placeKey = worldKey(placeX, placeY, placeZ);
  if (blockData[placeKey]) return;
  const color = 0xff9800;
  if (isMultiplayer && socket && socket.connected) {
    socket.emit('placeBlock', { pos: placeKey, block: { color } });
  }
  addBlock(placeX, placeY, placeZ, color);
}

function worldHeightAt(x, z) {
  return terrainHeight(Math.round(x), Math.round(z));
}

function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!isStarted) return;

  const yaw = localPlayer.rotation.y;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const moveSpeed = 0.12;
  let dx = 0;
  let dz = 0;
  if (keys.KeyW) dz -= 1;
  if (keys.KeyS) dz += 1;
  if (keys.KeyA) dx -= 1;
  if (keys.KeyD) dx += 1;

  if (dx !== 0 || dz !== 0) {
    forward.normalize();
    right.normalize();
    localPlayer.x += (forward.x * dz + right.x * dx) * moveSpeed;
    localPlayer.z += (forward.z * dz + right.z * dx) * moveSpeed;
  }

  const groundHeight = worldHeightAt(localPlayer.x, localPlayer.z) + 1.5;
  if (localPlayer.y <= groundHeight) {
    localPlayer.y = groundHeight;
    velocityY = 0;
    canJump = true;
  } else {
    velocityY -= 0.015;
    localPlayer.y += velocityY;
    canJump = false;
  }

  localPlayer.mesh.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
  camera.position.set(localPlayer.x, localPlayer.y + 0.9, localPlayer.z);
  camera.rotation.set(localPlayer.rotation.x, localPlayer.rotation.y, 0);

  if (isMultiplayer && socket && socket.connected) {
    socket.emit('move', {
      x: localPlayer.x,
      y: localPlayer.y,
      z: localPlayer.z,
      rotation: localPlayer.rotation
    });
  }

  renderer.render(scene, camera);
}

function connectMultiplayer() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('register', localPlayer.name);
    setStatus('Connected to BlockTopia server');
  });

  socket.on('init', (data) => {
    Object.keys(data.world).forEach((pos) => {
      const [x, y, z] = pos.split(',').map(Number);
      addBlock(x, y, z, data.world[pos].color);
    });
    Object.keys(data.players).forEach((id) => {
      if (id !== socket.id) addPlayerMesh(id, data.players[id]);
    });
  });

  socket.on('playerJoined', (data) => {
    addPlayerMesh(data.id, data.player);
    addChatMessage('System', `${data.player.name || 'A player'} joined`);
  });

  socket.on('playerMoved', (data) => {
    updatePlayerMesh(data.id, data.player);
  });

  socket.on('playerUpdated', (data) => {
    if (remotePlayers[data.id]) remotePlayers[data.id].name = data.player.name;
  });

  socket.on('playerLeft', (id) => {
    removePlayerMesh(id);
    addChatMessage('System', 'A player left the game');
  });

  socket.on('blockPlaced', (data) => {
    const [x, y, z] = data.pos.split(',').map(Number);
    addBlock(x, y, z, data.block.color);
  });

  socket.on('blockBroken', (data) => {
    removeBlock(data.pos);
  });

  socket.on('chat', (data) => {
    addChatMessage(data.name || data.id, data.message);
  });
}

function startGame() {
  if (isStarted) return;
  localPlayer.name = usernameInput.value.trim() || 'Guest';
  localStorage.setItem('blocktopiaName', localPlayer.name);
  isMultiplayer = modeSelect.value === 'multiplayer';
  localPlayer.x = 0;
  localPlayer.z = 0;
  localPlayer.y = worldHeightAt(localPlayer.x, localPlayer.z) + 1.5;

  overlay.style.display = 'none';
  updateUI();
  setStatus(isMultiplayer ? 'Connecting to multiplayer...' : 'Singleplayer ready');
  spawnLocalPlayer();

  if (isMultiplayer) {
    connectMultiplayer();
  } else {
    generateTerrain();
    setStatus('Singleplayer world ready');
  }

  isStarted = true;
  chatInput.disabled = false;
  chatButton.disabled = false;
}

startButton.addEventListener('click', startGame);

chatButton.addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (!message) return;
  if (isMultiplayer && socket && socket.connected) {
    socket.emit('chat', message);
  } else {
    addChatMessage(localPlayer.name, message);
  }
  chatInput.value = '';
});

chatInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') chatButton.click();
});

document.addEventListener('keydown', (event) => {
  if (event.target === chatInput) return;
  keys[event.code] = true;
  if (event.code === 'Space' && canJump) {
    velocityY = 0.25;
    canJump = false;
  }
  if (event.code === 'KeyT') {
    chatInput.focus();
  }
});

document.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

actionToggle.addEventListener('click', () => {
  currentAction = currentAction === 'place' ? 'break' : 'place';
  actionToggle.textContent = currentAction === 'place' ? 'Place' : 'Break';
});

moveForwardBtn.addEventListener('pointerdown', () => keys.KeyW = true);
moveForwardBtn.addEventListener('pointerup', () => keys.KeyW = false);
moveBackwardBtn.addEventListener('pointerdown', () => keys.KeyS = true);
moveBackwardBtn.addEventListener('pointerup', () => keys.KeyS = false);
moveLeftBtn.addEventListener('pointerdown', () => keys.KeyA = true);
moveLeftBtn.addEventListener('pointerup', () => keys.KeyA = false);
moveRightBtn.addEventListener('pointerdown', () => keys.KeyD = true);
moveRightBtn.addEventListener('pointerup', () => keys.KeyD = false);
jumpBtn.addEventListener('pointerdown', () => {
  if (canJump) {
    velocityY = 0.25;
    canJump = false;
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!isStarted) return;
  if (['INPUT', 'BUTTON', 'SELECT'].includes(event.target.tagName)) return;
  handleAction();
});

document.addEventListener('mousemove', (event) => {
  if (!isStarted) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  localPlayer.rotation.y -= event.movementX * 0.002;
  localPlayer.rotation.x -= event.movementY * 0.002;
  localPlayer.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, localPlayer.rotation.x));
});

renderer.domElement.addEventListener('click', () => {
  if (!isStarted) return;
  renderer.domElement.requestPointerLock?.();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

spawnLocalPlayer();
updateUI();
gameLoop();
