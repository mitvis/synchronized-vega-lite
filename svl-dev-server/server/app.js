const express = require('express');
const path = require('path');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const randomColor = require('randomcolor');

const publicPath = path.resolve(__dirname, '..', 'client');

app.use(express.static(publicPath));

const port = process.env.PORT || 3000;

http.listen(port, () => {
  console.log(`Listening on port ${port} and serving folder ${publicPath}`);
});

const users = {};
let annotations = {};
let spec;

io.on('connection', (socket) => {
  console.log(`user ${socket.id} connected`);

  users[socket.id] = { color: randomColor({ luminosity: 'dark' }) };
  socket.emit('color', users[socket.id].color);
  socket.emit('annotations', annotations);

  if (spec) {
    socket.emit('spec', spec);
  }

  socket.on('newSpec', (newSpec) => {
    spec = newSpec;
    annotations = {};
    io.emit('spec', spec);
  });

  socket.on('annotation', ({ annotation, selectionName }) => {
    const selectionId = socket.id + selectionName;
    if (annotation) {
      annotation = {
        ...annotation,
        _svlColor: users[socket.id].color,
      };
      annotations[selectionId] = annotation;
    } else {
      delete annotations[selectionId];
    }
    socket.broadcast.emit('annotations', annotations);
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
    const keys = Object.keys(annotations);
    for (const key of keys) {
      if (key.startsWith(socket.id)) {
        delete annotations[key];
      }
    }
    socket.broadcast.emit('annotations', annotations);

    if (Object.keys(users).length === 0) {
      spec = undefined;
    }
  });
});
