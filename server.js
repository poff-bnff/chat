const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const moment = require('moment')


const server = require('http').createServer()
const options = {
    pingInterval: 0.5*60*1000,
    pingTimeout: 5*1000
}
const io = require('socket.io')(server, options)
server.listen(3000)

var SOCKETPOOL = {}
const socketpool_filepath = path.join(__dirname, 'socketpool.yaml')
fs.writeFileSync(socketpool_filepath, '{}', 'utf8')
function saveSocketPool() {
    fs.writeFileSync(socketpool_filepath, yaml.safeDump(JSON.parse(JSON.stringify(SOCKETPOOL)), { 'noRefs': true, 'indent': '4' }), 'utf8')
}

var USERPOOL = {}
const userpool_filepath = path.join(__dirname, 'userpool.yaml')
if (fs.existsSync(userpool_filepath)) {
    USERPOOL = yaml.safeLoad(fs.readFileSync(userpool_filepath, 'utf8'))
} else {
    fs.writeFileSync(userpool_filepath, '{}', 'utf8')
}
function saveUserPool() {
    fs.writeFileSync(userpool_filepath, yaml.safeDump(USERPOOL, { 'noRefs': true, 'indent': '4' }), 'utf8')
}

var ROOMPOOL = {}
const roompool_filepath = path.join(__dirname, 'roompool.yaml')
if (fs.existsSync(roompool_filepath)) {
    ROOMPOOL = yaml.safeLoad(fs.readFileSync(roompool_filepath, 'utf8'))
} else {
    fs.writeFileSync(roompool_filepath, '{}', 'utf8')
}
function saveRoomPool() {
    fs.writeFileSync(roompool_filepath, yaml.safeDump(ROOMPOOL, { 'noRefs': true, 'indent': '4' }), 'utf8')
}

var MESSAGEPOOL = {}
const messagepool_filepath = path.join(__dirname, 'messagetpool.yaml')
if (fs.existsSync(messagepool_filepath)) {
    MESSAGEPOOL = yaml.safeLoad(fs.readFileSync(messagepool_filepath, 'utf8'))
} else {
    fs.writeFileSync(messagepool_filepath, '{}', 'utf8')
}
function saveMessagePool() {
    fs.writeFileSync(messagepool_filepath, yaml.safeDump(JSON.parse(JSON.stringify(MESSAGEPOOL)), { 'noRefs': true, 'indent': '4' }), 'utf8')
}


io.on('connection', (socket) => {
    console.log('a user connected', socket.id)
    SOCKETPOOL[socket.id] = null
    saveSocketPool()

    // socket.conn.on('packetCreate', function (packet) {
    //     if (packet.type === 'pong') console.log('=== sending pong');
    // })

    socket.on('joinRoom', (incoming_object) => {
        let access_level = 'user'
        if (true) {
            access_level = 'moderator'
        }
        const user_id = incoming_object.user_id
        const user_name = incoming_object.user_name
        const room_name = incoming_object.room_name
        const is_moderated = incoming_object.is_moderated
        console.log('joinRoom', { user_id, user_name, room_name, is_moderated })
        socket.join(room_name) // Nüüd on see socket seotud konkreetse nimeruumiga https://socket.io/docs/v3/rooms/index.html 

        SOCKETPOOL[socket.id] = {user_id, room_name, is_moderated}
        saveSocketPool()
    
        USERPOOL[user_id] = { user_name, access_level } //, userProfile }
        saveUserPool()
    
        ROOMPOOL[room_name] = ROOMPOOL[room_name] || { users: [], messages: [] }
        ROOMPOOL[room_name].users.push(user_id)
        ROOMPOOL[room_name].users = [...new Set(ROOMPOOL[room_name].users)]
        saveRoomPool()
    
        // socket.emit('messageToClient', formatMessage(user_id, 'tere-tere'))
    
        const previous_messages = ROOMPOOL[room_name].messages.slice(-10)
        for (message_id of previous_messages) {
            let message = MESSAGEPOOL[message_id]
            console.log('sending previous', {message})
            socket.emit('messageToClient', message)
        }
        // console.log(JSON.stringify({ USERPOOL, ROOMPOOL, USER_ROOMS, previous_messages }, null, 4))
    
        // k6igile v4lja arvatud kasutaja ise 
        // socket.broadcast
        //     .to(room_name)
        //     .emit('messageToClient', formatMessage(null, `+ ${user_name}`))
    
        // Send users and room info
        broadcastRoomUsers(room_name)
    })

    // Listen for chatMessage
    socket.on('messageToServer', ({ user_id, room_name, message }) => {
        console.log('got messageToServer', { socket: socket.id, user_id, room_name, message });
        if (!USERPOOL[user_id] || !ROOMPOOL[room_name] || !ROOMPOOL[room_name].users) {
            console.log({ E: 'Talking before entering...', user_id, room_name, message })
            socket.emit('Rejoin, please')
            return
        }
        const formatted_message = formatMessage(user_id, message)
        MESSAGEPOOL[formatted_message.id] = {user_id, room_name, ...formatted_message}
        saveMessagePool()

        ROOMPOOL[room_name].messages.push(formatted_message.id)
        ROOMPOOL[room_name].messages = [...new Set(ROOMPOOL[room_name].messages)]
        saveRoomPool()
        // console.log((JSON.stringify({ROOMPOOL}, null, 4)));
        io.to(room_name)
            .emit('messageToClient', MESSAGEPOOL[formatted_message.id])
    })

    socket.on('moderate', (message_id) => {
        let message = MESSAGEPOOL[message_id]
        message.is_moderated = true
        console.log('kas tõesti', {message, MESSAGEPOOL})
        saveMessagePool()
        io.to(message.room_name)
            .emit('messageToClient', message)
    })

    socket.on('disconnect', () => {
        let socket_id = socket.id
        if (SOCKETPOOL[socket_id] === null) {
            disconnectSocket(socket)
            console.log('close empty connection', socket_id)
            return
        }
        let room_name = SOCKETPOOL[socket_id].room_name
        let user_id = SOCKETPOOL[socket_id].user_id
        let user_name = USERPOOL[user_id].user_name
        console.log('Disconnecting', { socket_id, user_id, room_name })
        console.log('Disconnecting', JSON.stringify({ user: USERPOOL[user_id], room: ROOMPOOL[room_name] }, null, 4))
        removeUserFromRoompool(room_name, user_id)
        disconnectSocket(socket)

        io.to(room_name)
            .emit('messageToClient', formatMessage(null, `- ${user_name}`))
        removeUserFromRoompool(room_name, user_id)
        broadcastRoomUsers(room_name)
    })
})


function disconnectSocket(socket) {
    try {
        delete (SOCKETPOOL[socket.id])
        saveSocketPool()
    } catch (e) {
        console.log('cannot remove socket', socket.id, 'from pool', SOCKETPOOL)
    }
}

function removeUserFromRoompool(room_name, user_id) {
    try {
        let room_users = ROOMPOOL[room_name].users
        let user_index = room_users.indexOf(user_id)
        room_users.splice(user_index, 1)
        saveRoomPool()
    } catch (e) {
        console.log('cannot remove user', user_id, 'from room', ROOMPOOL)
    }
}

function broadcastRoomUsers(room_name) {
    io.to(room_name)
        .emit('roomUsers', {
            room: room_name,
            users: ROOMPOOL[room_name].users.map(user_id => USERPOOL[user_id].user_name)
        })
}

function formatMessage(user_id, text) {
    let user_name = 'bot'
    if (user_id !== null) {
        try {
            user_name = USERPOOL[user_id].user_name
        } catch (error) {
            console.log({ E: error, user_id, USERPOOL })
        }
    }
    return {
        id: 'u' + Date.now() + Math.floor(Math.random() * 1000),
        user_name,
        text,
        time: moment().format('HH:mm'),
        is_moderated: false
    }
}
