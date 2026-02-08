const tgBot = require('node-telegram-bot-api')
const axios = require('axios')
const express = require('express')
require('dotenv').config()
let app = express()
require('colors')
const { setNewDefault, getChatSettings, writeChanges} = require("./db");

const token = process.env.TG_TOKEN
const port = process.env.SERVER_PORT

const tiktokRegex = /(https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)/;

const bot = new tgBot(token, {polling: false})
async function clearBotQueue() {
    try {
        await bot.deleteWebHook({ drop_pending_updates: true })
        clog('\tBot can be used already. Bot polling can be enabled with delay.'.bold + '\n\t(f) TG bot queue is cleared')
        await bot.startPolling()
        clog('\t(f) TG bot polling has started')
    } catch (e) {
        clog('(f) Error clearing queue: ' + e)
    }
}
const owners = [ "penkodrist" ]
let consoleLogID = 0

app.listen(port, () => {
    clog(`Express server started`)
    clog(`dotEnv has loaded this data:\n\tTG_TOKEN=${token}\n\tSERVER_PORT=${port}`)
})

bot.getMe().then(me => {
    clog(`TG bot has loaded.\n\tBot name: ${me.first_name}\n\tUsername: ${me.username}`)
    clearBotQueue().then(() => clog('\tBot is fully loaded.'.bgGreen.bold.black))
}).catch(err => clog(`There was an error while loading the bot: ${err}`))

bot.on('message', async (msg) => {
    const chatId = msg.chat.id
    const text = msg.text
    // clog(`Bot has received a message:\n\tChat ID: ${chatId}\n\tChat text: ${text}`)
    // Проверка на наличие настроек для данного чата и наличие сообщения /start. При истинных значениях обоих бот не работает.
    // Ответное сообщение отправляет функция isInit в условии
    if (!await isInit(chatId, text)) {
        return
    }
    if (text && tiktokRegex.test(text)) {
        await botAction(msg, 'link', 'tiktok')
    }
})
bot.onText(/\/start/, async (msg) => { await botAction(msg, 'command', 'start') })
bot.onText(/\/help/, async (msg) => { await botAction(msg, 'command', 'help') })
bot.onText(/\/show_video_info/, async (msg) => { await botAction(msg, 'command', 'show_video_info') })
bot.onText(/\/parse_links/, async (msg) => { await botAction(msg, 'command', 'parse_links') })
bot.onText(/\/current_settings/, async (msg) => { await botAction(msg, 'command', 'current_settings') })
bot.on('polling_error', (error) => {
    clog(error.code);
});

// Вспомогательные функции для работы бота
async function isInit(chatId, text) {
    if (!getChatSettings(chatId) && text !== '/start') {
        await bot.sendMessage(chatId, '⚠️ Бот не инициализирован и не может работать. Для начала работы введите команду /start.')
        return false
    } else {
        return true
    }
}
async function botAction(msg, type, typeContent) {
    // Вся логика бота здесь. Функция предназначена только для отправки ответов. Удаление/изменение прописывается отдельно внутри функций или в отдельной внешней функции.
    const chatId = msg.chat.id
    const text = msg.text
    switch (type) {
        case "link":
            switch (typeContent) {
                case "tiktok": {
                    clog('Found MSG with TikTok link:'.bgGreen.black.bold)
                    const urlMatch = text.match(tiktokRegex)
                    const url = urlMatch[0]
                    clog('\ttiktokRegex match:' + url)
                    if (getChatSettings(chatId)["parseLinks"] === 'false' && text.length !== url.length) {
                        clog(`\tBot has disabled "parseLinks" option for chatId=${chatId}. MSG: ${text.bold}`)
                        return
                    }
                    try {
                        const processMsg = await bot.sendMessage(chatId, '⌛ Запрос обрабатывается...', {
                            reply_to_message_id: msg.message_id,
                        })
                        const req = `url=${encodeURIComponent(url)}&hd=1`
                        const res = await axios.post('https://www.tikwm.com/api/', req, {
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            }
                        });
                        const data = res.data
                        // консольный вывод для отладки ответа от API
                        // clog('\tReceived data from response:\n' + data)
                        if (data.code === 0) {
                            const title = data.data.title || 'ТТ Видео'
                            const author = data.data.author ? data.data.author.nickname : 'Неизвестный Автор'
                            // логика условия идет от обратного - если в видео нет картинок, то мы обрабатываем запрос на видео / в ином случае обрабатываем запрос на картинки
                            if (data.data.images && data.data.images.length < 0 || data.data.images === undefined) {
                                clog('\tProcessing video request'.bold)
                                const videoUrl = data.data.play
                                if (getChatSettings(chatId)["showVideoInfo"] === 'true') {
                                    await bot.sendVideo(chatId, videoUrl, {
                                        caption: `👤 Автор: ${author}\n🎥 ${title}\n`,
                                        reply_to_message_id: msg.message_id
                                    }).then(() => {
                                        clog('\tRequest has been satisfied!'.cyan.bold)
                                        bot.deleteMessage(chatId, processMsg.message_id)
                                    })
                                } else {
                                    await bot.sendVideo(chatId, videoUrl, {
                                        reply_to_message_id: msg.message_id
                                    }).then(() => {
                                        clog('\tRequest has been satisfied!'.cyan.bold)
                                        bot.deleteMessage(chatId, processMsg.message_id)
                                    })
                                }
                            } else {
                                clog('\tProcessing images request'.bold)
                                const images = data.data.images
                                if (images.length >= 10) {
                                    await bot.deleteMessage(chatId, processMsg.message_id).then(() => {
                                        throw new Error('Количество картинок превышает 10. Нельзя отправлять тиктоки с количеством, большим чем указанное выше. Это сделано, чтобы бекэнд не охуевал от нагрузки.')
                                    })
                                }
                                for (let i = 0; i < images.length; i += 10) {
                                    const chunk = images.slice(i, i + 10)
                                    const mediaGroup = chunk.map((imgUrl, index) => {
                                        return {
                                            type: 'photo',
                                            media: imgUrl,
                                            caption: (i === 0 && index === 0) ? `👤 Автор: ${author}\n📸 ${title}` : ''
                                        }
                                    })
                                    await bot.sendMediaGroup(chatId, mediaGroup, {
                                        reply_to_message_id: msg.message_id,
                                    }).then(() => {
                                        clog('\tRequest has been satisfied!'.cyan.bold)
                                        bot.deleteMessage(chatId, processMsg.message_id)
                                    })
                                }
                            }
                        } else {
                            clog('\ttikwm API response:' + data)
                            await bot.deleteMessage(chatId, processMsg.message_id).then(() => {
                                throw new Error('Не было найдено видео/картинок по указанной ссылке')
                            })
                        }
                    } catch(e) {
                        clog('\tError processing video request:' + e.message)
                        await bot.sendMessage(chatId, `⚠️ Произошла ошибка при выполнении запроса. Ошибка:\n${e.message}`, {
                            reply_to_message_id: msg.message_id,
                        })
                    }
                    break
                }
            }
            break
        case "command":
            switch (typeContent) {
                case "start": {
                    if (!getChatSettings(chatId)) {
                        setNewDefault(chatId)
                        clog(`\tNew chat detected. Setting default values for bot settings. Chat ID: ${chatId}`.bold)
                        await bot.sendMessage(chatId, 'Данный бот умеет загружать видео из TikTok. Чтобы начать его использование, просто отправьте ссылку на видео или альбом картинок. Доступные команды бота можно просмотреть командой /help.\n\nБот инициализирован и готов к работе.')
                    } else {
                        await bot.sendMessage(chatId, 'Бот уже инициализирован. Для вывода доступных команд введите /help')
                    }
                    break
                }
                case "help": {
                    await bot.sendMessage(chatId, '*Доступные комманды бота:*\n' +
                        '/start \\- запустить бота\n' +
                        '/help \\- вызвать меню доступных команд\n' +
                        '/show\\_video\\_info \\- отобразить автора и описание видео\n' +
                        '/parse\\_links \\- обрабатывать ссылки в сообщениях с ссылками на тиктоки\\. Если параметр выключен \\(false\\), то все сообщения, где есть что\\-то кроме ссылки на тикток, будут игнорироваться\n' +
                        '/current\\_settings \\- показать настройки бота для этого чата',
                        {
                            parse_mode: 'MarkdownV2'
                        }
                    )
                    break
                }
                case "show_video_info": {
                    writeSettings(msg, 'showVideoInfo', strBoolSwitch('showVideoInfo', chatId))
                    await bot.sendMessage(chatId, `Параметр showVideoInfo был изменен на: ${getChatSettings(chatId)["showVideoInfo"]}`);
                    break
                }
                case "parse_links": {
                    writeSettings(msg, 'parseLinks', strBoolSwitch('parseLinks', chatId))
                    await bot.sendMessage(chatId, `Параметр parseLinks был изменен на: ${getChatSettings(chatId)["parseLinks"]}`);
                    break
                }
                case "current_settings": {
                    const chatSettings = getChatSettings(chatId)
                    let reply = 'Текущие настройки бота для этого канала:\n'
                    for (let i = 1; i < Object.keys(chatSettings).length; i++) {
                        const objKey = Object.keys(chatSettings)[i]
                        reply += `${objKey}: ${chatSettings[objKey]}\n`
                        // лог для проверки значений настроек для чатов
                        // clog(`\t(f, i=${i}) ${objKey}: ${(chatSettings)[objKey]}`);
                    }
                    await bot.sendMessage(chatId, reply)
                    break
                }
            }
            break
        case "otherResponse":
            break
    }
}
function strBoolSwitch(setting, chatId) {
    try {
        if (getChatSettings(chatId)[setting] === 'true') {
            return 'false'
        } else {
            return 'true'
        }
    } catch (e) {
        clog('\t[ ERR ] Error in switching String boolean'.bold.bgRed.black)
    }

}
function writeSettings(msg, setting, value) {
    writeChanges(msg.chat.id, setting, value)
}
function clog(logText) {
    console.log(`${consoleLogID}`, logText)
    consoleLogID++
}

// Скрытые команды бота
bot.onText(/\/a.kill/, async (msg) => {
    const chatId = msg.chat.id
    try {
        await bot.deleteMessage(chatId, msg.message_id);
        if (owners.includes(msg.from.username)) {
            setTimeout(() => {
                process.exit()
            }, 1000)
        }
    } catch (e) {
        clog(`There was an error with OWNER command:`.bgRed.black.bold + e)
    }
})
bot.onText(/\/a.sql/, async (msg) => {
    const chatId = msg.chat.id
    try {
        await bot.deleteMessage(chatId, msg.message_id);
        if (owners.includes(msg.from.username)) {
            const chatData = getChatSettings(chatId)
            await bot.sendMessage(chatId, `Обращение к базе SQL выдало следующие данные, связанные с чатом ${chatId}:\n${JSON.stringify(chatData, null, 2)}`)
        }
    } catch (e) {
        clog(`There was an error with OWNER command:`.bgRed.black.bold + e)
    }
})