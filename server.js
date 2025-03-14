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
    const userMessageOriginal = event.text.trim();
    const userMessage = userMessageOriginal.toLowerCase();

    if (userMessageOriginal.includes(`<@${botUserId}>`)) {
      console.log("✅ Bot was mentioned!");
      const command = userMessage.replace(`<@${botUserId}>`, "").trim();
      
      // 1️⃣ Ambil history chat sebelum AI menjawab
      const history = await getChatHistory(channelId, "yesterday"); // Bisa ubah ke 'today' atau range lain
      
      // 2️⃣ Analisis intent berdasarkan perintah user
      const aiIntent = await analyzeIntent(command);
      console.log("📌 Intent detected:", aiIntent);

      // 3️⃣ Eksekusi perintah berdasarkan intent
      if (aiIntent.action === "list_tasks") {
        await listTasks(channelId, aiIntent.date, history);
      } else if (aiIntent.action === "delete_messages") {
        await removeBotMessages(channelId, aiIntent.date, aiIntent.count);
      } else {
        await aiResponse(channelId, command, history); // ⬅️ AI sekarang pakai history sebagai konteks
      }
    } else {
      console.log("⚠️ Bot was NOT mentioned, ignoring...");
    }
  }
  res.sendStatus(200);
});

// 🔥 Fungsi untuk mengambil history chat
async function getChatHistory(channel, date) {
  try {
    console.log(`📜 Fetching chat history from ${date} in channel ${channel}`);
    
    const fromTimestamp = moment(date, "YYYY-MM-DD").startOf("day").unix();
    
    const response = await slackClient.conversations.history({
      channel: channel,
      oldest: fromTimestamp.toString(),
      limit: 50, // Ambil 50 pesan terakhir
    });

    console.log(`📜 Found ${response.messages.length} messages`);
    return response.messages.map(msg => msg.text).join("\n"); // Gabungkan pesan sebagai satu teks
  } catch (error) {
    console.error("❌ Error fetching chat history:", error);
    return "";
  }
}

// 🔥 Modifikasi AI Response untuk pakai history chat
async function aiResponse(channelId, message, history) {
  console.log(`📌 AI is generating response for: "${message}"`);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful Slack assistant. Use the chat history for better context." },
        { role: "user", content: `Chat history:\n${history}` },
        { role: "user", content: `User's message: "${message}"` },
      ],
    });
    console.log("📥 OpenAI Response:", completion.choices[0].message.content);
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `🤖 ${completion.choices[0].message.content}`,
    });
  } catch (error) {
    console.error("❌ Error with AI response:", error);
  }
}

app.listen(port, () => {
  console.log(`🚀 Slack bot listening on port ${port}`);
});
