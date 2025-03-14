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
      const messageWithoutTag = userMessage.replace(`<@${botUserId}>`, "").trim();
      
      // 🔹 Periksa jika pengguna meminta bot menghapus chat terakhirnya
      if (messageWithoutTag.toLowerCase().includes("remove your last chat")) {
        console.log("🗑️ Removing last bot message...");
        await removeLastBotMessage(channelId);
      } else {
        await processCommand(channelId, messageWithoutTag);
      }
    }
  }

  res.sendStatus(200);
});

async function processCommand(channelId, userCommand) {
  console.log(`📌 Processing command: "${userCommand}"`);

  const matchDate = userCommand.match(/(yesterday|today|(\b\w+\bday\b))/i);
  let targetDate = moment().subtract(1, "days"); // Default: yesterday

  if (matchDate) {
    if (matchDate[0].toLowerCase() === "today") {
      targetDate = moment();
    } else if (matchDate[0].toLowerCase() === "yesterday") {
      targetDate = moment().subtract(1, "days");
    } else {
      targetDate = moment().day(matchDate[0]); // Example: "Monday" -> moment().day("Monday")
    }
  }

  const formattedDate = targetDate.format("YYYY-MM-DD");
  console.log(`📅 Fetching history for: ${formattedDate}`);

  const history = await fetchChatHistory(channelId, formattedDate);
  const aiResponse = await generateAIResponse(userCommand, history);

  await slackClient.chat.postMessage({
    channel: channelId,
    text: aiResponse,
  });

  console.log("✅ AI response sent!");
}

async function fetchChatHistory(channelId, targetDate) {
  console.log("🔹 Fetching chat history...");
  try {
    const response = await slackClient.conversations.history({
      channel: channelId,
      limit: 100,
    });

    const messages = response.messages.filter(msg =>
      moment.unix(msg.ts).format("YYYY-MM-DD") === targetDate
    );

    console.log(`🔹 Found ${messages.length} messages from ${targetDate}`);
    return messages.map(msg => `- ${msg.text}`).join("\n");
  } catch (error) {
    console.error("❌ Error fetching history:", error);
    return "No history found.";
  }
}

async function generateAIResponse(userCommand, chatHistory) {
  console.log(`🤖 Sending request to OpenAI...`);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a Slack assistant that summarizes chat history and answers based on past discussions." },
        { role: "user", content: `Here is the chat history:\n${chatHistory}\n\nNow, based on the command "${userCommand}", generate a relevant response.` }
      ],
    });

    console.log(`✅ AI Response: ${completion.choices[0].message.content}`);
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("❌ OpenAI API error:", error);
    return "Error generating AI response.";
  }
}

app.listen(port, () => {
  console.log(`🚀 Slack bot listening on port ${port}`);
});
