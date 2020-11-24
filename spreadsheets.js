const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')

const GoogleSheets = require('./GoogleSheets/GoogleSheets.js')
const LOG_SHEET = '1sBIia17T0Eg28zpLQco226tXnGFu-h5aioUvJPaSyrY'

let row = 4
let range = 'Sheet1!a2'
let values = [['foo']]
GoogleSheets.Write(LOG_SHEET, range, values)

