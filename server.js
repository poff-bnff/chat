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

const SOCKETPOOL = {}
const socketpool_filepath = path.join(__dirname, 'socketpool.yaml')
if (!fs.existsSync(socketpool_filepath)) {
    fs.writeFileSync(socketpool_filepath, '{}', 'utf8')
}
function saveSocketPool() {
    fs.writeFileSync(socketpool_filepath, yaml.safeDump(JSON.parse(JSON.stringify(SOCKETPOOL)), { 'noRefs': true, 'indent': '4' }), 'utf8')
}

const USERPOOL = {}
const userpool_filepath = path.join(__dirname, 'userpool.yaml')
if (!fs.existsSync(userpool_filepath)) {
    fs.writeFileSync(userpool_filepath, '{}', 'utf8')
}
function saveUserPool() {
    fs.writeFileSync(userpool_filepath, yaml.safeDump(USERPOOL, { 'noRefs': true, 'indent': '4' }), 'utf8')
}

const ROOMPOOL = {}
const roompool_filepath = path.join(__dirname, 'roompool.yaml')
if (!fs.existsSync(roompool_filepath)) {
    fs.writeFileSync(roompool_filepath, '{}', 'utf8')
}
function saveRoomPool() {
    fs.writeFileSync(roompool_filepath, yaml.safeDump(ROOMPOOL, { 'noRefs': true, 'indent': '4' }), 'utf8')
}

const MESSAGEPOOL = {}
const messagepool_filepath = path.join(__dirname, 'messagetpool.yaml')
if (!fs.existsSync(messagepool_filepath)) {
    fs.writeFileSync(messagepool_filepath, '{}', 'utf8')
}
function saveMessagePool() {
    fs.writeFileSync(messagepool_filepath, yaml.safeDump(JSON.parse(JSON.stringify(MESSAGEPOOL)), { 'noRefs': true, 'indent': '4' }), 'utf8')
}



const SOCKET_USER = {}
const USER_ROOMS = {}

io.on('connection', (socket) => {
    console.log('a user connected', socket.id)
    SOCKETPOOL[socket.id] = {}
    saveSocketPool()

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
    
        
        SOCKET_USER[socket.id] = user_id
        USERPOOL[user_id] = { socket_id: socket.id, user_name, access_level } //, userProfile }
        saveUserPool()
    
        ROOMPOOL[room_name] = ROOMPOOL[room_name] || { users: [], messages: [] }
        ROOMPOOL[room_name].users.push(user_id)
        ROOMPOOL[room_name].users = [...new Set(ROOMPOOL[room_name].users)]
        saveRoomPool()
    
        USER_ROOMS[user_id] = USER_ROOMS[user_id] || []
        USER_ROOMS[user_id].push(room_name)
        USER_ROOMS[user_id] = [...new Set(USER_ROOMS[user_id])]
    
        socket.emit('messageToClient', formatMessage(user_id, 'tere-tere'))
    
        const previous_messages = ROOMPOOL[room_name].messages.slice(-10)
        for (message of previous_messages) {
            socket.emit('messageToClient', message.message)
        }
        // console.log(JSON.stringify({ USERPOOL, ROOMPOOL, USER_ROOMS, previous_messages }, null, 4))
    
        // k6igile v4lja arvatud kasutaja ise 
        socket.broadcast
            .to(room_name)
            .emit('messageToClient', formatMessage(null, `+ ${user_name}`))
    
        // Send users and room info
        broadcastRoomUsers(room_name)
    })

    // Listen for chatMessage
    socket.on('messageToServer', ({ user_id, room_name, message }) => {
        console.log('got messageToServer', { socket: socket.id, user_id, room_name, message });
        if (!USERPOOL[user_id] || !ROOMPOOL[room_name] || !ROOMPOOL[room_name].users) {
            console.log({ E: 'Talking before entering...', user_id, room_name, message })
            return
        }
        const formatted_message = formatMessage(user_id, message)
        MESSAGEPOOL[formatted_message.id] = {user_id, room_name, ...formatted_message}
        saveMessagePool()

        ROOMPOOL[room_name].messages.push({ user_id: user_id, message: formatted_message })
        saveRoomPool()
        // console.log((JSON.stringify({ROOMPOOL}, null, 4)));
        io.to(room_name)
            .emit('messageToClient', formatted_message)
    })

    socket.on('moderate', (message_id) => {
        ROOMPOOL[room_name].messages
            .filter(m => m.id === message_id)
            .forEach(message_to_mod => {
                if (!message_to_mod.is_moderated) {
                    message_to_mod.is_moderated = true
                    
                }
            })
        saveRoomPool()
    })

    socket.on('disconnect', () => {
        const user_id = SOCKET_USER[socket.id]
        try {
            const user_name = USERPOOL[user_id].user_name
            const user_rooms = USER_ROOMS[user_id] || []
            for (const room_name of user_rooms) {
                io.to(room_name)
                    .emit('messageToClient', formatMessage(null, `- ${user_name}`))
                removeUserFromRoompool(room_name, user_id)
                broadcastRoomUsers(room_name)
            }
            USER_ROOMS[user_id] = []
            console.log('Disconnecting', { user_id, socket: socket.id });
            delete (SOCKET_USER[socket.id])
            delete (SOCKETPOOL[socket.id])
            saveSocketPool()
        } catch (e) {
            console.log('not a user (anymore?)', {socket_id: socket.id, user_id})
        }
    })
})


function removeUserFromRoompool(room_name, user_id) {
    let room_users = ROOMPOOL[room_name].users
    let user_index = room_users.indexOf(user_id)
    room_users.splice(user_index, 1)
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
