const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const players = {};
const world = {};

function terrainHeight(x, z) {
  return Math.max(0, Math.round(Math.sin(x * 0.2) * 2 + Math.cos(z * 0.18) * 2 + 3));
}

function buildTerrain(radius = 20) {
  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      const height = terrainHeight(x, z);
      for (let y = 0; y <= height; y++) {
        const pos = `${x},${y},${z}`;
        const color = y === height ? 0x4caf50 : y > 0 ? 0x8d5524 : 0x5d4037;
        world[pos] = { color };
      }
    }
  }
}

buildTerrain(22);

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  players[socket.id] = { x: 0, y: 5, z: 0, rotation: { x: 0, y: 0 }, name: 'Guest' };

  socket.emit('init', { players, world });
  socket.broadcast.emit('playerJoined', { id: socket.id, player: players[socket.id] });

  socket.on('register', (name) => {
    players[socket.id].name = name || 'Guest';
    io.emit('playerUpdated', { id: socket.id, player: players[socket.id] });
  });

  socket.on('move', (data) => {
    players[socket.id] = { ...players[socket.id], ...data };
    socket.broadcast.emit('playerMoved', { id: socket.id, player: players[socket.id] });
  });

  socket.on('placeBlock', (data) => {
    world[data.pos] = data.block;
    io.emit('blockPlaced', data);
  });

  socket.on('breakBlock', (data) => {
    delete world[data.pos];
    io.emit('blockBroken', data);
  });

  socket.on('chat', (message) => {
    const sender = players[socket.id] || { name: 'Guest' };
    io.emit('chat', { id: socket.id, name: sender.name, message });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});