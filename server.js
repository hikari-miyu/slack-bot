require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");

const app = express();
const port = process.env.PORT || 3000;
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

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
    }
  }

  res.sendStatus(200);
});

// Fungsi untuk mengambil list tugas dari channel Slack
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

app.listen(port, () => {
  console.log(`Slack bot listening on port ${port}`);
});
