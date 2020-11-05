var app = require('express')();

app.get( '/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
})


var http = require('http').createServer(app);

http.listen(80, () => {
  console.log('listening on *:80');
})


var io = require('socket.io')(http);

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.broadcast.emit('hi');
  socket.on('chat message', (msg) => {
    io.emit('chat message', msg);
  });
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
  socket.on('chat message', (msg) => {
    console.log('message: ' + msg);
  });
});

// io.emit('some event', { someProperty: 'some value', otherProperty: 'other value' }); // This will emit the event to all connected sockets
