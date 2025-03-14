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
      const aiIntent = await analyzeIntent(command);
      console.log("📌 Intent detected:", aiIntent);

      if (aiIntent.action === "list_tasks") {
        await listTasks(channelId, aiIntent.date);
      } else if (aiIntent.action === "delete_messages") {
        await removeBotMessages(channelId, aiIntent.date, aiIntent.count);
      } else {
        await aiResponse(channelId, command);
      }
    } else {
      console.log("⚠️ Bot was NOT mentioned, ignoring...");
    }
  }
  res.sendStatus(200);
});

async function analyzeIntent(command) {
  console.log(`📤 Sending request to OpenAI: "${command}"`);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      response_format: "json",
      messages: [
        {
          role: "system",
          content: `You are a Slack bot assistant that extracts user intent from messages. 
          Respond ONLY in JSON format. Example output:
          
          - {"action": "delete_messages", "date": "today"}
          - {"action": "list_tasks", "date": "yesterday"}
          - {"action": "summarize_chat", "date": "this week"}
          - {"action": "unknown"}
          
          Possible actions:
          - "delete_messages" -> When user wants to delete messages.
          - "list_tasks" -> When user asks for completed or pending tasks.
          - "summarize_chat" -> When user asks for a chat summary.
          - "unknown" -> If intent is unclear.

          Examples:
          - "delete all my messages today" -> {"action": "delete_messages", "date": "today"}
          - "erase my chats from yesterday" -> {"action": "delete_messages", "date": "yesterday"}
          - "what tasks were completed last week?" -> {"action": "list_tasks", "date": "last week"}
          - "summarize our chat from Monday" -> {"action": "summarize_chat", "date": "Monday"}
          - "hello bot, how are you?" -> {"action": "unknown"}
          `,
        },
        { role: "user", content: `Extract intent from: "${command}"` },
      ],
      response_format: "json",
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error("❌ Error analyzing intent:", error);
    return { action: "unknown" };
  }
}

async function removeBotMessages(channelId, date, count = 1) {
  try {
    console.log(`🗑️ Removing messages from bot in channel ${channelId}`);

    const response = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    let botMessages = response.messages.filter((msg) => msg.user === botUserId);

    if (date) {
      const targetDate = moment(date, "YYYY-MM-DD").startOf("day");
      botMessages = botMessages.filter((msg) =>
        moment.unix(msg.ts).isSame(targetDate, "day")
      );
    } else {
      botMessages = botMessages.slice(0, count);
    }

    for (const msg of botMessages) {
      console.log(`🚮 Deleting message: ${msg.text}`);
      await slackClient.chat.delete({ channel: channelId, ts: msg.ts });
    }

    await slackClient.chat.postMessage({
      channel: channelId,
      text: `✅ Removed ${botMessages.length} of my messages.`,
    });
  } catch (error) {
    console.error("❌ Error deleting messages:", error);
  }
}

async function aiResponse(channelId, message) {
  console.log(`📌 AI is generating response for: "${message}"`);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful Slack assistant." },
        { role: "user", content: message },
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
