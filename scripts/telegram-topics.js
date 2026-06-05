#!/usr/bin/env node

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const payload = await response.json();

if (!payload.ok) {
  console.error(payload.description ?? "Telegram getUpdates failed");
  process.exit(1);
}

const rows = [];

for (const update of payload.result) {
  const message = update.message ?? update.channel_post ?? update.edited_message;
  if (!message?.chat) continue;

  rows.push({
    update_id: update.update_id,
    chat_id: message.chat.id,
    chat_title: message.chat.title ?? message.chat.username ?? message.chat.first_name,
    chat_type: message.chat.type,
    message_thread_id: message.message_thread_id,
    topic_created: message.forum_topic_created?.name,
    text: message.text
  });
}

console.log(JSON.stringify(rows, null, 2));
