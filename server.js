require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");

const app = express();
const port = process.env.PORT || 3000;
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const botUserId = process.env.SLACK_BOT_USER_ID; // Pastikan ini diambil dari .env

app.use(express.json());

app.post("/slack/events", async (req, res) => {
  console.log("\n✅ Received Slack Event:");
  console.log(JSON.stringify(req.body, null, 2));

  const { type, challenge, event } = req.body;

  // 🔹 Step 1: Verifikasi URL dari Slack
  if (type === "url_verification") {
    console.log("🔹 URL Verification Event");
    return res.status(200).json({ challenge });
  }

  // 🔹 Step 2: Cek apakah ada pesan masuk
  if (event && event.type === "message" && !event.subtype) {
    console.log(`🔹 New Message Received: "${event.text}"`);
    const channelId = event.channel;
    const userMessage = event.text.trim();

    // 🔹 Step 3: Periksa apakah bot di-mention
    if (userMessage.includes(`<@${botUserId}>`)) {
      console.log("✅ Bot was mentioned!");
      const messageWithoutTag = userMessage.replace(`<@${botUserId}>`, "").trim();

      // 🔹 Step 4: Cek apakah pengguna meminta daftar tugas
      if (messageWithoutTag.toLowerCase().includes("list my tasks")) {
        console.log("📌 Detected 'list my tasks' command");
        await listTasks(channelId);
      } else {
        console.log("📌 AI response triggered");
        await aiResponse(channelId, messageWithoutTag);
      }
    } else {
      console.log("⚠️ Bot was NOT mentioned, ignoring...");
    }
  }

  res.sendStatus(200);
});

// 🔹 Fungsi untuk mengambil daftar tugas
async function listTasks(channelId) {
  console.log("🔹 Fetching task list from Slack...");
  try {
    const response = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    console.log(`🔹 ${response.messages.length} messages fetched`);
    const messages = response.messages;
    const tasks = [];

    for (const msg of messages) {
      if (msg.text.includes(":fire:")) {
        console.log(`✅ Task found: "${msg.text}"`);
        const permalink = await slackClient.chat.getPermalink({
          channel: channelId,
          message_ts: msg.ts,
        });
        tasks.push(`- ${msg.text} - ${permalink.permalink}`);
      }
    }

    const taskList = tasks.length ? tasks.join("\n") : "No tasks found.";
    console.log("📌 Sending task list to Slack...");
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `*Tasks finished:*\n${taskList}`,
    });
    console.log("✅ Task list sent successfully!");
  } catch (error) {
    console.error("❌ Error fetching tasks:", error);
  }
}

// 🔹 Fungsi untuk respon AI (sementara placeholder)
async function aiResponse(channelId, message) {
  console.log(`📌 AI is generating response for: "${message}"`);
  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `🤖 AI Response: "${message}"`,
    });
    console.log("✅ AI response sent!");
  } catch (error) {
    console.error("❌ Error sending AI response:", error);
  }
}

app.listen(port, () => {
  console.log(`🚀 Slack bot listening on port ${port}`);
});
