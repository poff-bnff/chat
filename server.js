const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')

const server = require('http').createServer()
const options = {
  pingInterval: 10000,
  pingTimeout: 5000
}
const io = require('socket.io')(server, options)
const moment = require('moment')

const userdata_dirpath = path.join(__dirname, '_userdata')
const messagedata_dirpath = path.join(__dirname, '_messagedata')
console.log(userdata_dirpath);

server.listen(3000)

const botName = 'Bot '

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('joinRoom', ({ userProfile, room }) => {
    
    const user = userJoin(socket.id, userProfile, room)

    // console.log(user)

    socket.join(user.room);

    // Welcome current user; kuvab ainult antud kasutajale 
    socket.emit('message', formatMessage(botName, 'Welcome to Chat!'));

    // Broadcast when a user connects k6igile v4lja arvatud kasutaja ise 
    socket.broadcast
      .to(user.room)
      .emit(
        'message',
        formatMessage(botName, `${user.username} has joined the chat`)
      );

    // io.emit() // kuvab k6igile

    // Send users and room info
    io.to(user.room).emit('roomUsers', {
      room: user.room,
      users: getRoomUsers(user.room)
    });
  });

  // Listen for chatMessage
  socket.on('chatMessage', ({ msg, room, userProfile }) => {
    const user = getCurrentUser(socket.id)
    console.log(user, msg)
    if( user.room === undefined){
      console.log('User added to room')
      user.room = room
    }
    io.to(user.room).emit('message', formatMessage(user.username, msg))

    // s6numid teeki
    let filePath = path.join(messagedata_dirpath, `${user.room}_messages.yaml`)
    message = {
      user: userProfile.username,
      message: msg
    }
    
    if(!fs.existsSync(filePath)){ 
      console.log('Open message data file, first user to post')
      let yamlStr = yaml.safeDump(JSON.parse(JSON.stringify([message])), { 'noRefs': true, 'indent': '4' })
      fs.appendFileSync(filePath, yamlStr, 'utf8')
    }else {
      console.log('User message added to message data')
      let yamlStr = yaml.safeDump(JSON.parse(JSON.stringify([message])), { 'noRefs': true, 'indent': '4' })
      fs.appendFileSync(filePath, yamlStr, 'utf8')
    }
  })

  // Runs when client disconnects
  socket.on('disconnect', () => {
    const user = userLeave(socket.id);

    if (user) {
      io.to(user.room).emit(
        'message',
        formatMessage(botName, `${user.username} has left the chat`)
      );

      // Send users and room info
      io.to(user.room).emit('roomUsers', {
        room: user.room,
        users: getRoomUsers(user.room)
      });
    }
  });
});

function formatMessage(username, text) {
  return {
    username,
    text,
    time: moment().format('hh:mm')
  };
}

const users = [];

// Join user to chat
function userJoin(id, userProfile, room) {
  
  let filePath = path.join(userdata_dirpath, `${room}.yaml`)
  
  if(!fs.existsSync(filePath)){
    console.log('Open room data file, first user in this room')
    
    let yamlStr = yaml.safeDump(JSON.parse(JSON.stringify([userProfile])), { 'noRefs': true, 'indent': '4' })
    fs.appendFileSync(filePath, yamlStr, 'utf8')
    
    let file = yaml.safeLoad(fs.readFileSync(filePath), 'utf-8')
    
    if (file.filter( user => user.username === userProfile.username) ){
      console.log('User already exists in room data file')
    }else {
      fs.appendFileSync(filePath, yamlStr, 'utf8')
    }
  }
  
  let username = userProfile.name
  const user = { id, username, room };
  
  users.push(user);
  console.log('users', users)

  return user;
}

// Get current user
function getCurrentUser(id) {
  return users.find(user => user.id === id);
}

// User leaves chat
function userLeave(id) {
  const index = users.findIndex(user => user.id === id);

  if (index !== -1) {
    return users.splice(index, 1)[0];
  }
}

// Get room users
function getRoomUsers(room) {
  return users.filter(user => user.room === room);
}

