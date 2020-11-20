const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const moment = require('moment')
const https = require('https')
const COGNITO_PROFILE_URL = 'https://api.poff.ee/trigger/cognitoprof?sub='

const server = require('http').createServer()
const options = {
    pingInterval: 1 * 60 * 1000,
    pingTimeout: 5 * 1000
}
const io = require('socket.io')(server, options)
server.listen(3000)

initializeLogs()

const MODERATORS = initializeModerators()

const socketpool_filepath = path.join(__dirname, 'socketpool.yaml')
const SOCKETPOOL = {}
savePool(SOCKETPOOL, socketpool_filepath)

const userpool_filepath = path.join(__dirname, 'userpool.yaml')
const USERPOOL = initializePool(userpool_filepath)

const roompool_filepath = path.join(__dirname, 'roompool.yaml')
const ROOMPOOL = initializePool(roompool_filepath)

const messagepool_filepath = path.join(__dirname, 'messagetpool.yaml')
const MESSAGEPOOL = initializePool(messagepool_filepath)


io.on('connection', (socket) => {
    console.log('connect', socket.id)
    SOCKETPOOL[socket.id] = null
    saveSocketPool()

    // socket.conn.on('packetCreate', function (packet) {
    //     if (packet.type === 'pong') console.log('=== sending pong')
    // })
    socket.conn.on('packet', function (packet) {
        if (packet.type === 'ping') {
            if (SOCKETPOOL[socket.id]) {
                savePing(SOCKETPOOL[socket.id].user_id, SOCKETPOOL[socket.id].room_name)
            }
        }
    })

    async function lookupUser(user_id) {
        return new Promise((resolve, reject) => {
            https.get(COGNITO_PROFILE_URL + user_id, (res) => {
                const { statusCode } = res
                const contentType = res.headers['content-type']
                console.log({ statusCode, contentType })
                let error
                if (statusCode !== 200) {
                    error = new Error(`Request Failed.\nStatus Code: ${statusCode}`)
                } else if (contentType !== 'application/json') {
                    error = new Error(`Invalid content-type.\nExpected "application/json" but received "${contentType}"`)
                }
                if (error) {
                    console.error({ 'Error message': error.message, error })
                    reject(error)
                }

                res.setEncoding('utf8')
                let rawData = ''
                res.on('data', (chunk) => {
                    rawData += chunk
                })
                res.on('end', () => {
                    // console.log(rawData)
                    json_data = JSON.parse(rawData)
                    resolve({user_name: json_data.name + ' ' + json_data.family_name, access_level: getAccessLevel(user_id)})
                })
            }).on('error', (e) => {
                console.error(`Got error: ${e.message}`)
            })
        })

        // const fetched = {"name":"Jaan","family_name":"Leppik","email":"jaan.leppik@poff.ee","industryUser":true}
        // if (!fetched.industryUser) {
        //     return false
        // }
        // return {user_name: fetched.name + ' ' + fetched.family_name, access_level: getAccessLevel(user_id)}
    }

    socket.on('joinRoom', async (incoming_object) => {
        const room_name = incoming_object.room_name
        const user_id = incoming_object.user_id
        console.log('join user', user_id, 'to room', room_name)
        const socket_user = await lookupUser(user_id) // {"user_name":"Jaan Leppik","access_level":"moderator"}
        console.log({ socket_user })
        if (socket_user.access_level === 'moderator') {
            socket.emit('YOU ARE MODERATOR')
        }
        if (SOCKETPOOL[socket.id]) {
            savePing(SOCKETPOOL[socket.id].user_id, SOCKETPOOL[socket.id].room_name)
        }

        socket.join(room_name) // Nüüd on see socket seotud konkreetse nimeruumiga https://socket.io/docs/v3/rooms/index.html 

        SOCKETPOOL[socket.id] = { user_id, room_name } //, is_moderated}
        saveSocketPool()

        USERPOOL[user_id] = { user_name: socket_user.user_name, access_level: socket_user.access_level } //, userProfile }
        saveUserPool()

        ROOMPOOL[room_name] = ROOMPOOL[room_name] || { users: [], messages: [] }
        ROOMPOOL[room_name].users.push(user_id)
        ROOMPOOL[room_name].users = [...new Set(ROOMPOOL[room_name].users)]
        saveRoomPool()

        const previous_messages = ROOMPOOL[room_name].messages.slice(-10)
        for (message_id of previous_messages) {
            let message = MESSAGEPOOL[message_id]
            socket.emit('messageToClient', message)
        }
        // k6igile v4lja arvatud kasutaja ise 
        // socket.broadcast
        //     .to(room_name)
        //     .emit('broadcast', formatMessage(null, `+ ${user_name}`))

        // Send users and room info
        // broadcastRoomUsers(room_name)
    })

    // Listen for chatMessage
    socket.on('messageToServer', ({ user_id, room_name, message }) => {
        console.log('got messageToServer', socket.id, user_id, room_name, message)
        if (!USERPOOL[user_id] || !ROOMPOOL[room_name] || !ROOMPOOL[room_name].users) {
            console.log({ E: 'Talking before entering...', user_id, room_name, message })
            socket.emit('Rejoin, please')
            return
        }
        const formatted_message = formatMessage(user_id, message)
        MESSAGEPOOL[formatted_message.id] = { user_id, room_name, ...formatted_message }
        saveMessagePool()

        ROOMPOOL[room_name].messages.push(formatted_message.id)
        ROOMPOOL[room_name].messages = [...new Set(ROOMPOOL[room_name].messages)]
        saveRoomPool()
        // console.log((JSON.stringify({ROOMPOOL}, null, 4)));
        io.to(room_name)
            .emit('messageToClient', MESSAGEPOOL[formatted_message.id])
    })

    socket.on('moderate', (message_id) => {
        if(USERPOOL[SOCKETPOOL[socket.id].user_id].access_level !== 'moderator') {
            return
        }
        let message = MESSAGEPOOL[message_id]
        message.is_moderated = true
        console.log('kas tõesti', { message, MP: MESSAGEPOOL[message_id] })
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
        console.log('Disconnecting', socket_id, user_id, 'from', room_name)
        removeUserFromRoompool(room_name, user_id)
        disconnectSocket(socket)

        // io.to(room_name)
        //     .emit('messageToClient', formatMessage(null, `- ${user_name}`))
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

// ---------------------
function getAccessLevel(user_id) {
    console.log(user_id, 'at', MODERATORS, 'is', MODERATORS.indexOf(user_id))
    return MODERATORS.indexOf(user_id) < 0 ? null: 'moderator'
}
function initializeModerators() {
    const moderators_filepath = path.join(__dirname, 'moderators.yaml')
    if (fs.existsSync(moderators_filepath)) {
        return yaml.safeLoad(fs.readFileSync(moderators_filepath, 'utf8'))
    } else {
        fs.writeFileSync(moderators_filepath, '[]', 'utf8')
        return []
    }
}
function initializePool(pool_filepath) {
    if (fs.existsSync(pool_filepath)) {
        return yaml.safeLoad(fs.readFileSync(pool_filepath, 'utf8'))
    } else {
        fs.writeFileSync(pool_filepath, '{}', 'utf8')
        return {}
    }
}
function savePool(pool, pool_filepath) {
    fs.writeFileSync(pool_filepath, yaml.safeDump(JSON.parse(JSON.stringify(pool)), { 'noRefs': true, 'indent': '4' }), 'utf8')
}
function saveSocketPool() {
    savePool(SOCKETPOOL, socketpool_filepath)
}
function saveUserPool() {
    savePool(USERPOOL, userpool_filepath)
}
function saveRoomPool() {
    savePool(ROOMPOOL, roompool_filepath)
}
function saveMessagePool() {
    savePool(MESSAGEPOOL, messagepool_filepath)
}
function initializeLogs() {
    for (const log_file of ['log/ping.txt']) {
        if (!fs.existsSync(log_file)) {
            fs.writeFileSync(log_file, '', 'utf8')
        }
    }
}
function savePing(user_id, room) {
    fs.appendFileSync('log/ping.txt', new Date() + ' | ' + user_id + ' | ' + USERPOOL[user_id].user_name + ' | ' + room + '\n')
}