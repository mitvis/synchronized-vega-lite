const randomColor = require('randomcolor');

const svlServer = (io) => {
  const users = {};
  let annotations = {};

  io.on('connection', (socket) => {
    console.log(`user ${socket.id} connected`);

    users[socket.id] = { color: randomColor({ luminosity: 'dark' }) };
    socket.emit('color', users[socket.id].color);
    socket.emit('annotations', annotations);

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

    socket.on('requestState', ({ user, track }) => {
      console.log(
        `${socket.id} requesting state from ${user}, tracking is ${track}`
      );
      io.to(user).emit('stateRequest', { to: socket.id, track });
    });

    socket.on('untrackState', (user) => {
      console.log(`${socket.id} untracking ${user}`);
      io.to(user).emit('untrack', socket.id);
    });

    socket.on('stateResponse', (response) => {
      console.log(`sending ${socket.id}'s state to ${response.to}`);
      if (Array.isArray(response.to)) {
        response.to.forEach((to) => {
          io.to(to).emit('remoteState', {
            user: socket.id,
            state: response.state,
          });
        });
      } else {
        io.to(response.to).emit('remoteState', {
          user: socket.id,
          state: response.state,
        });
      }
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
};

module.exports = svlServer;
