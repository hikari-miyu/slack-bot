require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");
const { OpenAI } = require("openai");
const moment = require("moment");

const app = express();
const port = process.env.PORT || 3000;
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const botUserId = process.env.SLACK_BOT_USER_ID;

app.use(express.json());

app.post("/slack/events", async (req, res) => {
  console.log("\n✅ Received Slack Event:", JSON.stringify(req.body, null, 2));

  const { type, challenge, event } = req.body;

  if (type === "url_verification") {
    return res.status(200).json({ challenge });
  }

  if (event && event.type === "message" && !event.subtype) {
    console.log(`🔹 New Message Received: "${event.text}"`);
    const channelId = event.channel;
    const userMessage = event.text.trim();

    if (userMessage.includes(`<@${botUserId}>`)) {
      console.log("✅ Bot was mentioned!");
      const messageWithoutTag = userMessage.replace(`<@${botUserId}>`, "").trim().toLowerCase();

      if (messageWithoutTag.includes("list my tasks")) {
        await listTasks(channelId, messageWithoutTag);
      } else if (messageWithoutTag.includes("remove your last chat")) {
        await removeLastBotMessage(channelId);
      } else {
        await aiResponse(channelId, messageWithoutTag);
      }
    }
  }

  res.sendStatus(200);
});

// 🔹 Mengambil daftar tugas berdasarkan filter waktu
async function listTasks(channelId, command) {
  console.log("🔹 Fetching task list...");
  try {
    const response = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    const messages = response.messages;
    const tasks = [];
    const timeFilter = parseDateFilter(command);

    for (const msg of messages) {
      if ((msg.text.includes("done") || msg.text.includes("finish")) && msg.text.includes("FD1-")) {
        const messageTime = moment.unix(msg.ts);
        if (!timeFilter || messageTime.isSame(timeFilter, "day")) {
          const permalink = await slackClient.chat.getPermalink({ channel: channelId, message_ts: msg.ts });
          tasks.push(`- ${msg.text} - ${permalink.permalink}`);
        }
      }
    }

    const taskList = tasks.length ? tasks.join("\n") : "No tasks found.";
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `*Tasks finished:*\n${taskList}`,
    });

  } catch (error) {
    console.error("❌ Error fetching tasks:", error);
  }
}

// 🔹 Menghapus pesan terakhir bot
async function removeLastBotMessage(channelId) {
  console.log("🔹 Searching for the last bot message to delete...");
  try {
    const response = await slackClient.conversations.history({ channel: channelId, limit: 20 });
    const botMessages = response.messages.filter(msg => msg.user === botUserId);

    if (botMessages.length > 0) {
      const lastBotMessage = botMessages[0];
      await slackClient.chat.delete({ channel: channelId, ts: lastBotMessage.ts });
      console.log("✅ Last bot message deleted successfully!");
    } else {
      console.log("⚠️ No bot messages found to delete.");
      await slackClient.chat.postMessage({
        channel: channelId,
        text: "⚠️ No recent bot messages found to delete."
      });
    }
  } catch (error) {
    console.error("❌ Error deleting message:", error);
  }
}

// 🔹 AI Response menggunakan OpenAI
async function aiResponse(channelId, message) {
  console.log(`📌 AI processing response for: "${message}"`);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: "You are a helpful assistant responding to Slack messages." },
                 { role: "user", content: message }],
    });

    const aiText = completion.choices[0].message.content;
    await slackClient.chat.postMessage({ channel: channelId, text: `🤖 AI Response: ${aiText}` });
    console.log("✅ AI response sent!");
  } catch (error) {
    console.error("❌ Error with AI response:", error);
  }
}

// 🔹 Parsing tanggal dari command
function parseDateFilter(command) {
  const today = moment().startOf("day");

  if (command.includes("today")) return today;
  if (command.includes("yesterday")) return today.subtract(1, "day");
  const match = command.match(/(\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/i);
  if (match) return moment().day(match[1]).startOf("day");

  return null;
}

app.listen(port, () => {
  console.log(`🚀 Slack bot listening on port ${port}`);
});
