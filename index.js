const tgBot = require('node-telegram-bot-api')
const axios = require('axios')
const express = require('express')
require('dotenv').config()
let app = express()
require('colors')
const db = require('./db')

const token = process.env.TG_TOKEN
const port = process.env.SERVER_PORT

const tiktokRegex = /(https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)/;
const bot = new tgBot(token, {polling: false})
async function clearBotQueue() {
    try {
        await bot.deleteWebHook({ drop_pending_updates: true })
        console.log('\tBot can be used already. Bot polling can be enabled with delay.'.bold + '\n\t(f) TG bot queue is cleared')
        await bot.startPolling()
        console.log('\t(f) TG bot polling has started')
    } catch (e) {
        console.log('(f) Error clearing queue: ', e)
    }
}

const botSettings = {
    "0": {
        showVideoInfo: true,
        parseLinks: true
    }
}
const administrators = {
    "0": ["penkodrist"]
}
const owners = [ "penkodrist" ]

app.listen(port, () => {
    console.log(`Express server started`)
    console.log(`dotEnv has loaded this data:\n\tTG_TOKEN=${token}\n\tSERVER_PORT=${port}`)
})

bot.getMe().then(me => {
    console.log(`TG bot has loaded.\n\tBot name: ${me.first_name}\n\tUsername: ${me.username}`)
    clearBotQueue().then(() => console.log('\tBot is ready.'.bgGreen.bold.black))
}).catch(err => console.log(`There was an error while loading the bot: ${err}`))
bot.setMyCommands([
    { command: '/start', description: "Запустить бота" },
    { command: "/help", description: "Вывести список доступных команд бота" },
])
bot.on('message', async(msg) => {
    // console.log(`Bot has received a message:\n\tChat ID: ${chatId}\n\tChat text: ${text}`)
    const chatId = msg.chat.id
    const text = msg.text
    // console.log(`${text && tiktokRegex.test(text)}`.bgWhite.black.bold)
    if(text && tiktokRegex.test(text)) {
        console.log('Found MSG with TikTok link:'.bgGreen.black.bold)
        const urlMatch = text.match(tiktokRegex)
        const url = urlMatch[0]
        console.log('\ttiktokRegex match:', url)
        if (botSettings["0"]["parseLinks"] === false && text.length !== url.length) {
            console.log(`\tBot has disabled "parseLinks" option for chatId=${chatId}. MSG: ${text.bold}`)
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
            // console.log('\tReceived data from response:\n', data)
            if (data.code === 0) {
                const title = data.data.title || 'ТТ Видео'
                const author = data.data.author ? data.data.author.nickname : 'Неизвестный Автор'
                // логика условия идет от обратного - если в видео нет картинок, то мы обрабатываем запрос на видео / в ином случае обрабатываем запрос на картинки
                if (data.data.images && data.data.images.length < 0 || data.data.images === undefined) {
                    console.log('\tProcessing video request'.bold)
                    const videoUrl = data.data.play
                    if (botSettings["0"]["showVideoInfo"]) {
                        await bot.sendVideo(chatId, videoUrl, {
                            caption: `👤 Автор: ${author}\n🎥 ${title}\n`,
                            reply_to_message_id: msg.message_id
                        }).then(() => {
                            console.log('\tRequest has been satisfied!'.cyan.bold)
                            bot.deleteMessage(chatId, processMsg.message_id)
                        })
                    } else {
                        await bot.sendVideo(chatId, videoUrl, {
                            reply_to_message_id: msg.message_id
                        }).then(() => {
                            console.log('\tRequest has been satisfied!'.cyan.bold)
                            bot.deleteMessage(chatId, processMsg.message_id)
                        })
                    }
                } else {
                    console.log('\tProcessing images request'.bold)
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
                            console.log('\tRequest has been satisfied!'.cyan.bold)
                            bot.deleteMessage(chatId, processMsg.message_id)
                        })
                    }
                }
            } else {
                console.log('\ttikwm API response:', data)
                await bot.deleteMessage(chatId, processMsg.message_id).then(() => {
                    throw new Error('Не было найдено видео/картинок по указанной ссылке')
                })
            }
        } catch(e) {
            console.log('\tError processing video request:', e.message)
            await bot.sendMessage(chatId, `⚠️ Произошла ошибка при выполнении запроса. Ошибка:\n${e.message}`, {
                reply_to_message_id: msg.message_id,
            })
        }

    }
})
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id
    await bot.sendMessage(chatId, 'Данный бот умеет загружать видео из TikTok. Чтобы начать его использование, просто отправьте ссылку на видео или альбом картинок. Доступные команды бота можно просмотреть командой /help.')
})
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id
    await bot.sendMessage(chatId, '*Доступные комманды бота:*\n' +
        '/start \\- запустить бота\n' +
        '/help \\- вызвать меню доступных команд\n' +
        '🔴 /showVideoInfo \\- отобразить автора и описание видео\n' +
        '🔴 /parseLinks \\- обрабатывать ссылки в сообщениях с ссылками на тиктоки\\. Если параметр выключен \\(false\\), то все сообщения, где есть что\\-то кроме ссылки на тикток, будут игнорироваться\n' +
        '/currentSettings \\- показать настройки бота для этого чата',
        {
            parse_mode: 'MarkdownV2'
        }
    )
})
bot.onText(/\/showVideoInfo/, async (msg) => {
    const chatId = msg.chat.id
    botSettings["0"]["showVideoInfo"] = !botSettings["0"]["showVideoInfo"];
    await bot.sendMessage(chatId, `Параметр showVideoInfo был изменен на: ${botSettings["0"]["showVideoInfo"]}`);
})
bot.onText(/\/parseLinks/, async (msg) => {
    const chatId = msg.chat.id
    botSettings["0"]["parseLinks"] = !botSettings["0"]["parseLinks"];
    await bot.sendMessage(chatId, `Параметр parseLinks был изменен на: ${botSettings["0"]["parseLinks"]}`);
})

bot.on('polling_error', (error) => {
    console.log(error.code);
});

// Скрытые команды бота

bot.onText(/\/kill/, async (msg) => {
    const chatId = msg.chat.id
    try {
        await bot.deleteMessage(chatId, msg.message_id);
        if (owners.includes(msg.from.username)) {
            setTimeout(() => {
                process.exit()
            }, 1000)
        }
    } catch (e) {
        console.log(`There was an error with OWNER command:`.bgRed.black.bold, e)
    }
})