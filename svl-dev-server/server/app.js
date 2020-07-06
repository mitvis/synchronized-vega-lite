const express = require('express');
const path = require('path');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const publicPath = path.resolve(__dirname, '..', 'client');

app.use(express.static(publicPath));

const svlPath = path.resolve(
  __dirname,
  '..',
  'node_modules',
  'synchronized-vega-lite',
  'cdn'
);

app.use('/svl', express.static(svlPath));

const port = process.env.PORT || 3000;

http.listen(port, () => {
  console.log(`Listening on port ${port} and serving folder ${publicPath}`);
});

let spec;

io.on('connection', (socket) => {
  if (spec) {
    socket.emit('spec', spec);
  }

  socket.on('newSpec', (newSpec) => {
    spec = newSpec;
    annotations = {};
    io.emit('spec', spec);
  });
});

require('svl-server')(io);
