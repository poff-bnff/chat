const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const moment = require('moment')
const { userInfo } = require('os')


const server = require('http').createServer()
const options = {
    pingInterval: 10000,
    pingTimeout: 5000
}
const io = require('socket.io')(server, options)
server.listen(3000)

const userpool_filepath = path.join(__dirname, 'userpool.yaml')
if (!fs.existsSync(userpool_filepath)) {
    fs.writeFileSync(userpool_filepath, '{}', 'utf8')
}
const roompool_filepath = path.join(__dirname, 'roompool.yaml')
if (!fs.existsSync(roompool_filepath)) {
    fs.writeFileSync(roompool_filepath, '{}', 'utf8')
}


const SOCKET_USER = {}
const USERPOOL = {}
const ROOMPOOL = {}
const USER_ROOMS = {}

io.on('connection', (socket) => {
    // console.log('a user connected', socket.id)

    socket.on('joinRoom', (incoming_object) => {
        joinUserToRoom(incoming_object, socket)
    })

    // Listen for chatMessage
    socket.on('messageToServer', ({ user_id, room_name, message }) => {
        console.log('got messageToServer', { user_id, room_name, message });
        if (!USERPOOL[user_id] || !ROOMPOOL[room_name] || !ROOMPOOL[room_name].users) {
            console.log({ E: 'Talking before entering...', user_id, room_name, message })
            return
        }
        ROOMPOOL[room_name].messages.push({user_id: user_id, message: message})
        console.log((JSON.stringify({ROOMPOOL}, null, 4)));
        io.to(room_name)
            .emit('messageToClient', formatMessage(user_id, message))
    })

    socket.on('disconnect', () => {
        const user_id = SOCKET_USER[socket.id]
        console.log('Disconnecting', {user_id, SOCKET_USER});
        if (user_id) {
            const user_name = USERPOOL[user_id].user_name
            const user_rooms = USER_ROOMS[user_id] || []
            for (const room_name of user_rooms) {
                io.to(room_name)
                .emit('messageToClient', formatMessage(null, `- ${user_name}`))
                console.log('Before', ROOMPOOL)
                removeUserFromRoompool(room_name, user_id)
                console.log('After', ROOMPOOL)
                broadcastRoomUsers(room_name)
            }
            USER_ROOMS[user_id] = []
            console.log('Disconnecting', {socket: socket.id, user: SOCKET_USER[socket.id], SOCKET_USER});
            delete(SOCKET_USER[socket.id])
        }
    })
})

function removeUserFromRoompool(room_name, user_id) {
    let room_users = ROOMPOOL[room_name].users
    let user_index = room_users.indexOf(user_id)
    room_users.splice(user_index, 1)
}

function joinUserToRoom(incoming_object, socket) {
    const user_id = incoming_object.user_id
    const user_name = incoming_object.user_name
    const room_name = incoming_object.room_name
    const userProfile = incoming_object.userProfile
    console.log('joinRoom', {user_id, user_name, room_name})
    socket.join(room_name) // Nüüd on see socket seotud konkreetse nimeruumiga https://socket.io/docs/v3/rooms/index.html 

    SOCKET_USER[socket.id] = user_id
    USERPOOL[user_id] = { socket_id: socket.id, user_name} //, userProfile }

    ROOMPOOL[room_name] = ROOMPOOL[room_name] || { users: [], messages: [] }
    ROOMPOOL[room_name].users.push(user_id)
    ROOMPOOL[room_name].users = [...new Set(ROOMPOOL[room_name].users)]

    USER_ROOMS[user_id] = USER_ROOMS[user_id] || []
    USER_ROOMS[user_id].push(room_name)
    USER_ROOMS[user_id] = [...new Set(USER_ROOMS[user_id])]
    
    socket.emit('messageToClient', formatMessage(user_id, 'tere-tere'))
    
    const previous_messages = ROOMPOOL[room_name].messages.slice(-10)
    for (message of previous_messages) {
        socket.emit('messageToClient', formatMessage(message.user_id, message.message))
    }
    console.log(JSON.stringify({USERPOOL, ROOMPOOL, USER_ROOMS, previous_messages}, null, 4))

    // k6igile v4lja arvatud kasutaja ise 
    socket.broadcast
        .to(room_name)
        .emit('messageToClient', formatMessage(null, `+ ${user_name}`))

    // Send users and room info
    broadcastRoomUsers(room_name)
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
        user_name,
        text,
        time: moment().format('HH:mm')
    }
}
