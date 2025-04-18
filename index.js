const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');


const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'aphroai'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  }
  console.log('✅ Connection to MySQL established.');
});

const bot = new TelegramBot('8072295643:AAESrEsB8N7dTK_KSRS_4gNkTZP0zqb67N0', { polling: true });
const userStates = new Map();

//start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const startKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📥 Create new folder', callback_data: 'start_get_messages' },
          { text: '📂 View folder', callback_data: 'start_save_messages' }
        ],
        [
          { text: '🗑️ Delete folder', callback_data: 'start_delete_folder' },
          { text: '🛑 End of storage', callback_data: 'start_end_messages' }
        ],
        [
          { text: '📨 Send feedback', callback_data: 'send_feedback' }
        ]
      ]
    }
  };

  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Gifs(.mp4)📥', callback_data: '/gifs' },
          { text: 'stikers📥', callback_data: '/stikers' },
          { text: 'Vids📥', callback_data: '/vids' },
          { text: 'pics📥', callback_data: '/ops_pics' }
        ]
      ]
    }
  };

  const welcomeMessage = `🎉 Welcome to the Message Saver Bot!

With this bot, you can categorize and keep your important messages forever. 📁

🛠 Features:
1️⃣ /get_messages – Create a new folder and start saving messages
2️⃣ /end_messages – End saving messages
3️⃣ /save_messages – View messages saved in a folder
4️⃣ /delete_folder – Delete a folder with confirmation
5️⃣ Supports photos, gifs, videos, stickers, and more

To get started, tap one of the buttons below ⬇️
`;

  await clearUserState(chatId);
  bot.sendMessage(chatId, welcomeMessage, startKeyboard).then(() => {
    bot.sendMessage(chatId, "🛠Special Features:", inlineKeyboard);
  });
});



//command(s)
bot.onText(/\/get_messages/, async (msg) => {
  const chatId = msg.chat.id;
  await setUserState(chatId, 'waiting_folder_name');
  bot.sendMessage(chatId, 'Please enter the name of the folder you want to save to:');
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const state = userStates.get(chatId);
  

  if (!state) return;

  if (state.step === 'waiting_folder_name') {
    const folderName = msg.text;  

    //Save folder in database
    connection.query(
      'INSERT INTO folders (user_id, folder_name) VALUES (?, ?)',
      [chatId, folderName],
      (err, results) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Error saving folder.');
          return;
        }

        const folderId = results.insertId;
        userStates.set(chatId, { step: 'recording', folderId });
        bot.sendMessage(chatId, `Folder "${folderName}" has been created. You can now forward your messages.`);
      }
    );
    
  }

  if (state.step === 'recording') {
    let fileId = null;
    let type = null;

    if (msg.photo) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      type = 'photo';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      type = 'video';
    } else if (msg.sticker) {
      fileId = msg.sticker.file_id;
      type = 'sticker';
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      type = 'gif';
    } else {
      return; //Nothing can be saved.
    }
    
    connection.query(
      'INSERT INTO messages (folder_id, message_type, file_id) VALUES (?, ?, ?)',
      [state.folderId, type, fileId],
      (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Error saving message.');
        } else {
          bot.sendMessage(chatId, '✅ Message saved.');
        }

      }
    );
  }
});

bot.onText(/\/end_messages/, async (msg) => {
  const chatId = msg.chat.id;
  await clearUserState(chatId);
  bot.sendMessage(chatId, '✅ Saving messages is complete.');
});


bot.onText(/\/save_messages/, async (msg) => {
  const chatId = msg.chat.id;
  await setUserState(chatId, 'waiting_folder_to_show');
  bot.sendMessage(chatId, '🗂️ Please enter the name of the folder you want to see messages from:');
});


bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = await getUserState(chatId);

  if (!state) return;

  //Step: Get the folder name
  if (state.step === 'waiting_folder_name') {
    const folderName = msg.text;
    connection.query(
      'INSERT INTO folders (user_id, folder_name) VALUES (?, ?)',
      [chatId, folderName],
      async (err, results) => {
        if (err) return bot.sendMessage(chatId, '❌ Error saving folder.');
        await setUserState(chatId, 'recording', results.insertId);
        bot.sendMessage(chatId, `The folder "${folderName}" has been created. You can now send photos, stickers, GIFs, or videos.`);
      }
    );
  }

  else if (state.step === 'waiting_folder_to_delete') {
    const folderName = msg.text;
  
    connection.query(
      'SELECT id FROM folders WHERE user_id = ? AND folder_name = ?',
      [chatId, folderName],
      async (err, results) => {
        if (err || results.length === 0) {
          bot.sendMessage(chatId, '❌ No folder with this name was found.');
          return;
        }
  
        const folderId = results[0].id;
  
        //Save status for confirmation
        await setUserState(chatId, 'confirm_deletion', folderId);
  
        bot.sendMessage(chatId, `⚠️ Are you sure you want to delete the folder "${folderName}"?`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Yes, delete', callback_data: 'confirm_delete' },
                { text: '❌ No, cancel', callback_data: 'cancel_delete' }
              ]
            ]
          }
        });
      }
    );
  }
  
  // Step: Saving media
  else if (state.step === 'recording') {
    let fileId = null;
    let type = null;

    if (msg.photo) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      type = 'photo';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      type = 'video';
    } else if (msg.sticker) {
      fileId = msg.sticker.file_id;
      type = 'sticker';
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      type = 'gif';
    }

    if (!fileId || !type) return;

    connection.query(
      'INSERT INTO messages (folder_id, message_type, file_id) VALUES (?, ?, ?)',
      [state.folder_id, type, fileId],
      (err) => {
        if (err) bot.sendMessage(chatId, '❌ Error saving message.');
        else bot.sendMessage(chatId, '✅ Message saved.');
      }
    );
  }

  // Step: View messages in a folder
  else if (state.step === 'waiting_folder_to_show') {
    const folderName = msg.text;

    connection.query(
      'SELECT id FROM folders WHERE user_id = ? AND folder_name = ?',
      [chatId, folderName],
      (err, results) => {
        if (err || results.length === 0) {
          bot.sendMessage(chatId, '❌ Folder not found.');
          return;
        }

        const folderId = results[0].id;

        connection.query(
          'SELECT * FROM messages WHERE folder_id = ?',
          [folderId],
          async (err, messages) => {
            if (err || messages.length === 0) {
              bot.sendMessage(chatId, '❌ There is no message to display.');
              return;
            }

            for (const msgObj of messages) {
              bot.sendDocument(chatId, msgObj.file_id).catch(() => {
                bot.sendMessage(chatId, `📂 Type: ${msgObj.message_type}`);
              });
            }
            

            await clearUserState(chatId);
          }
        );
        
      }
    );
  }
});

bot.onText(/\/delete_folder/, async (msg) => {
  const chatId = msg.chat.id;
  await setUserState(chatId, 'waiting_folder_to_delete');
  bot.sendMessage(chatId, '📁 Please enter the name of the folder you want to delete:');
});

//query(s)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const state = await getUserState(chatId);

  if (!state || state.step !== 'confirm_deletion') return;

  const folderId = state.folder_id;

  if (query.data === 'confirm_delete') {
    // Delete messages in a folder
    connection.query(
      'DELETE FROM messages WHERE folder_id = ?',
      [folderId],
      (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Error deleting messages.');
          return;
        }

       // Delete the folder itself
        connection.query(
          'DELETE FROM folders WHERE id = ?',
          [folderId],
          async (err) => {
            if (err) {
              bot.sendMessage(chatId, '❌ Error deleting folder.');
            } else {
              bot.sendMessage(chatId, '🗑️ Folder successfully deleted.');
              await clearUserState(chatId);
            }
          }
        );
      }
    );
  } else if (query.data === 'cancel_delete') {
    await clearUserState(chatId);
    bot.sendMessage(chatId, '✅ Folder deletion canceled.');
  }
  else if (data === 'send_feedback') {
    await setUserState(chatId, 'waiting_for_feedback');
    bot.sendMessage(chatId, '📝 لطفاً پیام یا مشکلی که می‌خواهید ارسال کنید را بنویسید:');
  }
  
  

  // Remove keyboard after response
  bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === 'start_get_messages') {
    await setUserState(chatId, 'waiting_folder_name');
    bot.sendMessage(chatId, '📝 Please enter the name of the folder you want to create:');
  }

  else if (data === 'start_save_messages') {
    await setUserState(chatId, 'waiting_folder_to_show');
    bot.sendMessage(chatId, '📁 Please enter the name of the folder you want to see messages from:');
  }

  else if (data === 'start_delete_folder') {
    await setUserState(chatId, 'waiting_folder_to_delete');
    bot.sendMessage(chatId, '🗑️ Please enter the name of the folder you want to delete:');
  }

  else if (data === 'start_end_messages') {
    await clearUserState(chatId);
    bot.sendMessage(chatId, '✅ Message storage has stopped.');
  }

  // Remove buttons after click (optional)
  bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id
  });
});

bot.on('callback_query', (query) => {
  const chatID = query.message.chat.id;
  const data = query.data;

  if (data === '/stikers') {
      const stickers = [
          "assets/private/stikers/1.webm",
          "assets/private/stikers/12.webm",
          "assets/private/stikers/13.webm",
          "assets/private/stikers/14.webm",
          "assets/private/stikers/15.webm",
          "assets/private/stikers/16.webm",
          "assets/private/stikers/17.webm",
          "assets/private/stikers/18.webm",
          "assets/private/stikers/2.webm",
          "assets/private/stikers/21.webm",
          "assets/private/stikers/22.webm",
          "assets/private/stikers/23.webm",
          "assets/private/stikers/24.webm"
      ];

      stickers.forEach((stickerPath) => {
          bot.sendSticker(chatID, stickerPath).catch(err => {
              console.error("❌ Failed to send:", stickerPath, err.message);
          });
      });
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('callback_query', (query) => {
  const chatID = query.message.chat.id;
  const data = query.data;

  if (data === '/gifs') {
      const videos = [
          { type: 'video', media: 'assets/private/gifs/1.mp4' },
          { type: 'video', media: 'assets/private/gifs/2.mp4' },
          { type: 'video', media: 'assets/private/gifs/3.mp4' },
          { type: 'video', media: 'assets/private/gifs/4.mp4' },
          { type: 'video', media: 'assets/private/gifs/5.mp4' },
          { type: 'video', media: 'assets/private/gifs/6.mp4' },
          { type: 'video', media: 'assets/private/gifs/7.mp4' },
          { type: 'video', media: 'assets/private/gifs/8.mp4' },
          { type: 'video', media: 'assets/private/gifs/9.mp4' }
      ];

      bot.sendMediaGroup(chatID, videos).catch(err => {
          console.error("❌ Error sending videos:", err);
      });
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('callback_query', (query) => {
  const chatID = query.message.chat.id;
  const data = query.data;

  if (data === '/vids') {
      const message = 'Comming Soon... https://mega.nz/folder/iV8lUJQR#1IYa2qew_AyrpOMTAbdfsg .';
      bot.sendMessage(chatID, message);
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('callback_query', (query) => {
  const chatID = query.message.chat.id;
  const data = query.data;

  if (data === '/ops_pics') {
      const photos = [
          { type: 'photo', media: 'https://cdni.pornpics.com/1280/7/302/22438799/22438799_037_daaf.jpg' },
          { type: 'photo', media: 'https://cdni.pornpics.com/1280/7/180/86543980/86543980_095_ea9b.jpg' },
          { type: 'photo', media: 'https://cdni.pornpics.com/1280/7/693/24590130/24590130_081_2ecb.jpg' },
          { type: 'photo', media: 'https://cdni.pornpics.com/1280/7/581/47193408/47193408_080_fc7d.jpg' }
      ];

      bot.sendMediaGroup(chatID, photos).catch(err => {
          console.error("❌ Failed to send photos:", err.message);
      });
  }

  bot.answerCallbackQuery(query.id);
});


//function(s)
function setUserState(user_id, step, folder_id = null) {
  return new Promise((resolve, reject) => {
    connection.query(
      'REPLACE INTO user_states (user_id, step, folder_id) VALUES (?, ?, ?)',
      [user_id, step, folder_id],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function getUserState(user_id) {
  return new Promise((resolve, reject) => {
    connection.query(
      'SELECT * FROM user_states WHERE user_id = ?',
      [user_id],
      (err, results) => {
        if (err) reject(err);
        else resolve(results[0] || null);
      }
    );
  });
}

function clearUserState(user_id) {
  return new Promise((resolve, reject) => {
    connection.query(
      'DELETE FROM user_states WHERE user_id = ?',
      [user_id],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

