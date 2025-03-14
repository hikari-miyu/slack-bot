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
  const { type, challenge, event } = req.body;

  if (type === "url_verification") {
    return res.status(200).json({ challenge });
  }

  if (event && event.type === "message" && !event.subtype) {
    const channelId = event.channel;
    const userMessage = event.text.trim().toLowerCase();

    if (userMessage.includes(`<@${botUserId}>`)) {
      const command = userMessage.replace(`<@${botUserId}>`, "").trim();
      const aiIntent = await analyzeIntent(command);
      
      if (aiIntent.action === "list_tasks") {
        await listTasks(channelId, aiIntent.date);
      } else if (aiIntent.action === "delete_messages") {
        await removeBotMessages(channelId, aiIntent.date, aiIntent.count);
      } else {
        await aiResponse(channelId, command);
      }
    }
  }
  res.sendStatus(200);
});

async function analyzeIntent(command) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a Slack bot that extracts intent, date, and count from user messages." },
        { role: "user", content: `Extract intent from: "${command}"` },
      ],
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error("❌ Error analyzing intent:", error);
    return { action: "unknown" };
  }
}

async function removeBotMessages(channelId, date, count = 1) {
  try {
    const response = await slackClient.conversations.history({ channel: channelId, limit: 100 });
    let botMessages = response.messages.filter(msg => msg.user === botUserId);
    if (date) {
      const targetDate = moment(date, "YYYY-MM-DD").startOf("day");
      botMessages = botMessages.filter(msg => moment.unix(msg.ts).isSame(targetDate, "day"));
    } else {
      botMessages = botMessages.slice(0, count);
    }
    for (const msg of botMessages) {
      await slackClient.chat.delete({ channel: channelId, ts: msg.ts });
    }
    await slackClient.chat.postMessage({ channel: channelId, text: `✅ Removed ${botMessages.length} of my messages.` });
  } catch (error) {
    console.error("❌ Error deleting messages:", error);
  }
}

async function aiResponse(channelId, message) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful Slack assistant." },
        { role: "user", content: message },
      ],
    });
    await slackClient.chat.postMessage({ channel: channelId, text: `🤖 ${completion.choices[0].message.content}` });
  } catch (error) {
    console.error("❌ Error with AI response:", error);
  }
}

app.listen(port, () => {
  console.log(`🚀 Slack bot listening on port ${port}`);
});
