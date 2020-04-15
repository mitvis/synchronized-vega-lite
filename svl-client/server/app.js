const express = require('express');
const path = require('path');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const randomColor = require('randomcolor');

const publicPath = path.resolve(__dirname, '..', 'client');

app.use(express.static(publicPath));

http.listen(3000, () => {
  console.log(`Listening on port 3000 and serving folder ${publicPath}`);
});

const users = {};
const annotations = {};

io.on('connection', (socket) => {
  console.log(`user ${socket.id} connected`);

  users[socket.id] = { color: randomColor({ luminosity: 'dark' }) };
  socket.emit('color', users[socket.id].color);
  socket.emit('annotations', annotations);

  socket.on('annotation', (annotation) => {
    if (annotation) {
      annotation = {
        ...annotation,
        color: users[socket.id].color,
      };
      annotations[socket.id] = annotation;
    } else {
      delete annotations[socket.id];
    }
    socket.broadcast.emit('annotations', { [socket.id]: annotation });
  });

  socket.on('requestState', (user) => {
    console.log(`${socket.id} requesting state from ${user}`);
    io.to(user).emit('stateRequest', socket.id);
  });

  socket.on('stateResponse', (response) => {
    console.log(`sending ${socket.id}'s state to ${response.to}`);
    io.to(response.to).emit('remoteState', {
      user: socket.id,
      state: response.state,
    });
  });

  socket.on('disconnect', () => {
    console.log(`user ${socket.id} disconnected`);
    delete users[socket.id];
    delete annotations[socket.id];
    socket.broadcast.emit('annotations', { [socket.id]: null });
  });
});
