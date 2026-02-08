const Database = require('better-sqlite3')
const db = new Database('botSettings.db'/*, { verbose: console.log }*/)

const defaultSettingsValues = {
    showVideoInfo: "true",
    parseLinks: "true"
}

const createTable = `
    CREATE TABLE IF NOT EXISTS chatsSettings (
        id INTEGER PRIMARY KEY,
        showVideoInfo TEXT NOT NULL,
        parseLinks TEXT NOT NULL
    );
`
db.exec(createTable)

function getChatSettings(chatId) {
    const getValues = db.prepare(`SELECT * FROM chatsSettings WHERE id = ?`)
    return getValues.get(chatId);
}

function setNewDefault(chatId) {
    const addNewDefaultSettings = db.prepare(`
        INSERT INTO chatsSettings (id, showVideoInfo, parseLinks)
        VALUES (@id, @showVideoInfo, @parseLinks)
    `)
    addNewDefaultSettings.run({ ...defaultSettingsValues, id: chatId })
}

function writeChanges(chatId, setting, value) {
    const writeSettings = db.prepare(`UPDATE chatsSettings SET ${setting} = ? WHERE id = ?`)
    writeSettings.run(value, chatId)
}

module.exports = { getChatSettings, setNewDefault, writeChanges }