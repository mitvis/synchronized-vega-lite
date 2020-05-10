const express = require('express');
const path = require('path');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const publicPath = path.resolve(__dirname, '..', 'client');

app.use(express.static(publicPath));

const port = process.env.PORT || 3000;

http.listen(port, () => {
  console.log(`Listening on port ${port} and serving folder ${publicPath}`);
});

require('svl-server')(io);
