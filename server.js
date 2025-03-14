require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");
const { OpenAI } = require("openai");

const app = express();
const port = process.env.PORT || 3000;
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());

app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  // Verifikasi event Slack
  if (type === "url_verification") {
    return res.status(200).json({ challenge });
  }

  // Jika ada pesan masuk
  if (event && event.type === "message" && !event.subtype) {
    const channelId = event.channel;
    const userMessage = event.text.toLowerCase();

    if (userMessage.includes("list me my tasks")) {
      await listTasks(channelId);
    } else {
      const aiResponse = await askOpenAI(userMessage);
      await slackClient.chat.postMessage({ channel: channelId, text: aiResponse });
    }
  }

  res.sendStatus(200);
});

// Fungsi untuk mengambil list tugas dari channel Slack berdasarkan emoji 🔥
async function listTasks(channelId) {
  try {
    const response = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    const messages = response.messages;
    const tasks = [];

    for (const msg of messages) {
      if (msg.text.includes(":fire:")) {
        const permalink = await slackClient.chat.getPermalink({
          channel: channelId,
          message_ts: msg.ts,
        });
        tasks.push(`- ${msg.text} - ${permalink.permalink}`);
      }
    }

    const taskList = tasks.length ? tasks.join("\n") : "No tasks found.";
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `*Tasks finished:*\n${taskList}`,
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
  }
}

// Fungsi untuk bertanya ke OpenAI
async function askOpenAI(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error with OpenAI:", error);
    return "Sorry, I couldn't process your request.";
  }
}

app.listen(port, () => {
  console.log(`Slack bot listening on port ${port}`);
});
