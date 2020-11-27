const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const moment = require('moment')
const https = require('https')
const COGNITO_PROFILE_URL = 'https://api.poff.ee/trigger/cognitoprof?sub='
// const GoogleSheets = require('./GoogleSheets/GoogleSheets.js')
const LOG_SHEET = '1sBIia17T0Eg28zpLQco226tXnGFu-h5aioUvJPaSyrY'

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
    // console.log('connect', socket.id)
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
        if (packet.type === 'pong') {
            console.log(util.inspect({pong: packet}, null, 4))
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
                // console.log({ statusCode, contentType })
                let error
                if (statusCode !== 200) {
                    error = new Error(`Request Failed.\nStatus Code: ${statusCode} user_id: ${user_id}`)
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
                    let json_data = JSON.parse(rawData)
                    let user_name = 'J. Doe'
                    if (json_data.name && json_data.family_name) {
                        user_name = json_data.name + ' ' + json_data.family_name
                    }
                    resolve({user_name, access_level: getAccessLevel(user_id)})
                })
            }).on('error', (e) => {
                console.error(`Got request error: ${e.message}`)
            })
        })
    }

    socket.on('joinRoom', async (incoming_object) => {
        console.log({'I': 'join', ...incoming_object})
        // console.log(incoming_object)
        let room_name = incoming_object.room_name
        let user_id = incoming_object.user_id
        if (incoming_object.API_VERSION && incoming_object.API_VERSION === '2') {
            room_name = incoming_object.LOCATION
            user_id = incoming_object.USER_ID
        }
        console.log('join user', user_id, 'to room', room_name)
        const socket_user = await lookupUser(user_id)
        // console.log({ socket_user })
        
        // ver 1
        if (socket_user.access_level === 'moderator') {  
            socket.emit('YOU ARE MODERATOR')
        }
        // ---
        socket.emit('ARE U MODERATOR', socket_user.access_level === 'moderator')
        // ver 2

        
        socket.join(room_name) // Nüüd on see socket seotud konkreetse nimeruumiga https://socket.io/docs/v3/rooms/index.html 
        
        SOCKETPOOL[socket.id] = { user_id, room_name } //, is_moderated}
        saveSocketPool()
        saveJoin(user_id, room_name)

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

    socket.on('Track me', async (incoming_object) => {
        const user_id = incoming_object.user_id
        const socket_user = await lookupUser(user_id) // {"user_name":"Jaan Leppik","access_level":"moderator"}
        
        const slug = incoming_object.hostname + incoming_object.pathname
        SOCKETPOOL[socket.id] = { user_id, slug }
        saveSocketPool()
        saveTrack(user_id, slug)

        USERPOOL[user_id] = { user_name: socket_user.user_name, access_level: socket_user.access_level }
        saveUserPool()
    })

    // Listen for chatMessage
    socket.on('messageToServer', (incoming_object) => {
        console.log({'I': 'message', ...incoming_object})
        let room_name = incoming_object.room_name
        let user_id = incoming_object.user_id
        let message = incoming_object.message
        if (incoming_object.API_VERSION && incoming_object.API_VERSION === '2') {
            room_name = incoming_object.LOCATION
            user_id = incoming_object.USER_ID
        }

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

    socket.on('moderate message', (incoming_object) => {
        console.log({'I': 'moderate', ...incoming_object})
        let message_id = incoming_object.message_id
        if(USERPOOL[SOCKETPOOL[socket.id].user_id].access_level !== 'moderator') {
            return
        }
        let message = MESSAGEPOOL[message_id]
        message.is_moderated = true
        // console.log('kas tõesti', { message, MP: MESSAGEPOOL[message_id] })
        saveMessagePool()
        io.to(message.room_name)
            .emit('messageToClient', message)
    })

    socket.on('disconnect', (incoming_object) => {
        console.log({'I': 'disconnect', S: socket.id})
        let socket_id = socket.id
        if (SOCKETPOOL[socket_id] === null) {
            disconnectSocket(socket)
            // console.log('close empty connection', socket_id)
            return
        }
        // let room_name = SOCKETPOOL[socket_id].room_name
        // let user_id = SOCKETPOOL[socket_id].user_id
        // let user_name = USERPOOL[user_id].user_name
        // // console.log('Disconnecting', socket_id, user_id, 'from', room_name)
        // removeUserFromRoompool(room_name, user_id)
        disconnectSocket(socket)

        // io.to(room_name)
        //     .emit('messageToClient', formatMessage(null, `- ${user_name}`))
        // removeUserFromRoompool(room_name, user_id)
        // broadcastRoomUsers(room_name)
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
    if (!room_name && !user_id) {
        console.log({E: 'Trying to remove noone from nowhere. Deep.'})
        return
    }
    if (!room_name) {
        console.log({E: 'Trying to remove user [' + user_id + '] from nowhere'})
        return
    }
    if (!user_id) {
        console.log({E: 'Trying to remove noone from [' + room_name + ']. Why bother?'})
        return
    }
    try {
        let room_users = ROOMPOOL[room_name].users
        let user_index = room_users.indexOf(user_id)
        room_users.splice(user_index, 1)
        saveRoomPool()
    } catch (E) {
        console.log('cannot remove user', user_id, 'from room', room_name, ROOMPOOL, E)
    }
}

function broadcastRoomUsers(room_name) {
    if (!room_name) {
        console.log({E: 'Can not broadcast without room name'})
        return
    }
    try {
        io.to(room_name)
            .emit('roomUsers', {
                room: room_name,
                users: ROOMPOOL[room_name].users.map(user_id => USERPOOL[user_id].user_name)
            })
    } catch (E) {
        console.log({room_name, E})
    }
}

function formatMessage(user_id, text) {
    let user_name = 'bot'
    if (user_id !== null) {
        try {
            user_name = USERPOOL[user_id].user_name
        } catch (E) {
            console.log({ E, user_id, USERPOOL })
        }
    }
    return {
        id: 'u' + Date.now() + Math.floor(Math.random() * 1000),
        user_name,
        text,
        time: moment().add(2, 'hours').format('HH:mm'),
        is_moderated: false
    }
}

// ---------------------
function getAccessLevel(user_id) {
    // console.log(user_id, 'at', MODERATORS, 'is', MODERATORS.indexOf(user_id))
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
    for (const log_file of ['log/ping.txt','log/join.txt', 'log/track.txt']) {
        if (!fs.existsSync(__dirname + '/' + log_file)) {
            fs.writeFileSync(__dirname + '/' + log_file, '', 'utf8')
        }
    }
}
function savePing(user_id, room) {
    fs.appendFileSync(__dirname + '/' + 'log/ping.txt', new Date().toISOString() + ' | ' + user_id + ' | ' + USERPOOL[user_id].user_name + ' | ' + room + '\n')
    // const values = dumpLogRow('ping', user_id, location)
    // GoogleSheets.Append(LOG_SHEET, 'realtime!a2', values)
}
function saveJoin(user_id, room) {
    try {
        fs.appendFileSync(__dirname + '/' + 'log/join.txt', new Date().toISOString() + ' | ' + user_id + ' | ' + USERPOOL[user_id].user_name + ' | ' + room + '\n')
        // const values = dumpLogRow('join', user_id, location)
        // GoogleSheets.Append(LOG_SHEET, 'realtime!a2', values)
        } catch (error) {
        console.log({E: error});        
    }
}
function saveTrack(user_id, location) {
    if (!user_id) {
        console.log({E: 'Trying to track nobody?'})
        return
    }
    if (!USERPOOL[user_id]) {
        console.log({E: 'User [' . user_id + '] has escaped the pool'})
        return
    }
    if (!location) {
        location = '~~~/nowhere/~~~'
    }
    try {
        fs.appendFileSync(__dirname + '/' + 'log/track.txt', new Date().toISOString() + ' | ' + user_id + ' | ' + USERPOOL[user_id].user_name + ' | ' + location + '\n')
        // const values = dumpLogRow('track', user_id, location)
        // GoogleSheets.Append(LOG_SHEET, 'realtime!a2', values)
    } catch (error) {
        console.log({E: error});        
    }
}
function dumpLogRow(type, user_id, location) {
    const d = new Date()
    console.log({d, iso: d.toISOString(), s1: d.toISOString().substring(0,10), s2: d.toISOString().substring(18, 8)})
    return values = [[
        type,
        d.toISOString().substring(0, 10),
        d.toISOString().substring(11, 19),
        user_id,
        USERPOOL[user_id].user_name,
        location
    ]]
}
