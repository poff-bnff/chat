const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const moment = require('moment')


const server = require('http').createServer()
const options = {
  pingInterval: 10000,
  pingTimeout: 5000
}
const io = require('socket.io')(server, options)
server.listen(3000)


const userdata_dirpath = path.join(__dirname, '_userdata')
const messagedata_dirpath = path.join(__dirname, '_messagedata')
const userpool_filepath = path.join(__dirname, 'userpool.yaml')
if(!fs.existsSync(userpool_filepath)) {
  fs.appendFileSync(userpool_filepath, '---', 'utf8')
}

const users = [];

io.on('connection', (socket) => {
  console.log('a user connected', socket.id)

  socket.on('joinRoom', ({ userId, userName, roomName, userProfile }) => {
    const user = userJoin(socket.id, userProfile, room)

    console.log(user)

    socket.join(user.room);

    // Welcome current user    // peaks kohe kaas panema hulk vanu s6numeid 
    const previous_messages = getLastMessages(room, 10)
    for( message of previous_messages)
    {
      socket.emit('message', formatMessage(message.user, message.message))
    }

    // Broadcast when a user connects k6igile v4lja arvatud kasutaja ise 
    socket.broadcast
      .to(user.room)
      .emit(
        'message',
        formatMessage(null, `${userProfile.name} has joined the chat`)
      );

    // Send users and room info
    io.to(user.room).emit('roomUsers', {
      room: user.room,
      users: getRoomUsers(user.room)
    })
  })


  // Listen for chatMessage
  socket.on('chatMessage', ({ msg, room, userProfile }) => {
    const user = getCurrentUser(socket.id)

    let room_name = room
    if(room.substring(room.length -10, room.length) === '_moderated'){
      room_name = room.substring(0, room.length -10)
    }
    let moderated_room_name = room_name + '_moderated'
    
    if(!user){
      userJoin(socket.id, userProfile, room) 
    }
    if( user.room === undefined){
      console.log('User added to room')
      user.room = room
    }

    io.to(user.room).emit('message', formatMessage(userProfile.sub, msg))
    // io.to(user.room_name).emit('message', formatMessage(userProfile.sub, msg))
    // io.to(user.moderated_room_name).emit('message', formatMessage(userProfile.sub, msg))

    // save messages
    let filePath = path.join(messagedata_dirpath, `${user.room}_messages.yaml`)
    message = {
      user: userProfile.sub,
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
        formatMessage(null, `${user.sub} has left the chat`)
      );

      // Send users and room info
      io.to(user.room).emit('roomUsers', {
        room: user.room,
        users: getRoomUsers(user.room)
      });
    }
  })
})

function formatMessage(usersub, text) {
  let username = 'bot'
  if (usersub !== null) {
    try {
      username = readUserFromPool(usersub).name
    } catch (error) {
      console.log({E: error, usersub});    
    }
  }
  return {
    username,
    text,
    time: moment().format('HH:mm')
  };
}


// Join user to chat
function userJoin(id, userProfile, room) {
  
  let yamlStr = yaml.safeDump(JSON.parse(JSON.stringify([userProfile])), { 'noRefs': true, 'indent': '4' })
  
  let userdata_filePath = path.join(userdata_dirpath, `${room}.yaml`)
  if(!fs.existsSync(userdata_filePath)){
    console.log('Open room data file, first user in this room')  
    fs.appendFileSync(userdata_filePath, yamlStr, 'utf8')
  }
  
  let userpool = yaml.safeLoad(fs.readFileSync(userdata_filePath), 'utf8') || []

  let connected_user = userpool.filter( user => user.sub === userProfile.sub)

  if (connected_user.length > 0){
    console.log('User already exists in room data file')
  } else {
    console.log('Adding user to pool', {userdata_filePath, userProfile, room})
    fs.appendFileSync(userdata_filePath, yamlStr, 'utf8')
  }
  
  let sub = userProfile.sub
  const user = { id, sub, room };
  
  users.push(user)
  saveUserToPool(userProfile.sub, userProfile)

  return user;
}

function saveUserToPool(sub, userProfile) {
  let userpool = yaml.safeLoad(fs.readFileSync(userpool_filepath), 'utf8') || {}
  userpool[sub] = userProfile
  let yamlStr = yaml.safeDump(JSON.parse(JSON.stringify(userpool)), { 'noRefs': true, 'indent': '4' })
  fs.writeFileSync(userpool_filepath, yamlStr, 'utf8')
}

function readUserFromPool(sub) {
  let userpool = yaml.safeLoad(fs.readFileSync(userpool_filepath), 'utf8') || {}
  return userpool[sub] || null
}

// Get current user
function getCurrentUser(id) {
  return users.find(user => user.id === id) || false;
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
  return users.filter(user => user.room === room)
    .map(user => readUserFromPool(user.sub))
}

function getLastMessages(room, count) {

  let message_file_name = path.join(messagedata_dirpath, `${room}_messages.yaml`)
  if(!fs.existsSync(message_file_name)){ 
    return []
  }
  let messageYaml = yaml.safeLoad(fs.readFileSync(message_file_name, 'utf8'))
  let lastMessages = messageYaml.slice(-(count), -1)
  return lastMessages
}

