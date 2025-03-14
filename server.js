require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");
const { OpenAI } = require("openai");
const moment = require("moment");

const app = express();
const port = process.env.PORT || 3000;

const slackBot = new WebClient(process.env.SLACK_BOT_TOKEN);
const slackClient = new WebClient(process.env.SLACK_BOT_AS_USER_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const botUserId = process.env.SLACK_BOT_USER_ID;

app.use(express.json());

const botResponses = {}; // Menyimpan pesan bot untuk penghapusan jika user tidak puas

/**
 * Menangani event dari Slack
 */
app.post("/slack/events", async (req, res) => {
  // console.log("\n✅ Received Slack Event:", JSON.stringify(req.body, null, 2));
  const { type, challenge, event } = req.body;

  // 🔥 Kirim respons lebih awal untuk menghindari event berulang
  res.sendStatus(200);

  // Slack URL verification
  if (type === "url_verification") {
    console.log("🔍 Verifying Slack URL...");
    return res.status(200).json({ challenge });
  }

  if (!event) {
    console.log("⚠️ No event found in request.");
    return;
  }

  // console.log(`🔔 Received event of type: ${event.type}`);

  // Jika event adalah pesan teks
  if (
    event.type === "message" &&
    !event.subtype &&
    event.text.includes(`<@${botUserId}>`)
  ) {
    // console.log("📝 Message detected!");
    const channelId = event.channel;
    const userMessageOriginal = event.text.trim();

    if (userMessageOriginal.includes(`<@${botUserId}>`)) {
      // console.log("✅ Bot was mentioned!");
      const command = userMessageOriginal.replace(`<@${botUserId}>`, "").trim();

      // Ambil history chat
      // console.log("📜 Fetching today's chat history...");
      const history = await getChatHistory(channelId);
      console.log("✅ Chat history retrieved!");

      // Analisis intent dari user menggunakan OpenAI
      // console.log(`🤖 Sending command to OpenAI: "${command}"`);
      const response = await processWithAI(command, history);
      // console.log(`📩 OpenAI Response: "${response}"`);

      // Kirim jawaban ke Slack channel
      // console.log("📤 Sending response to Slack channel...");
      const sentMessage = await slackBot.chat.postMessage({
        channel: channelId,
        text: `🤖 ${response}`,
      });

      // Simpan ts pesan bot agar bisa dihapus jika user tidak puas
      botResponses[sentMessage.ts] = channelId;
      console.log(`✅ Bot message stored: ${sentMessage.ts}`);
    }
  }

  if (event && event.type === "reaction_added") {
    // console.log(
    //   `🔍 Reaction event detected: ${JSON.stringify(event, null, 2)}`
    // );

    if (event.reaction === "x") {
      // console.log(
      //   `❌ User ${event.user} added ❌ reaction to message ${event.item.ts}`
      // );
      await deleteBotMessage(event);
    }
  }
});

/**
 * Mengambil history chat dari Slack dalam batas 7 hari terakhir
 */
// async function getChatHistory(channel) {
//   try {
//     console.log(`📜 Fetching today's chat history from channel ${channel}`);

//     // Set batas waktu hanya dari hari ini
// const sevenDaysAgo = moment().subtract(3, "days").startOf("day").unix();
//     const now = moment().unix();

//     // Ambil pesan dari Slack API
//     const response = await slackBot.conversations.history({
//       channel: channel,
//       oldest: todayStart.toString(), // Hanya ambil pesan sejak hari ini
//       latest: now.toString(),
//       limit: 100, // Ambil maksimal 100 pesan
//     });

//     console.log(`📜 Found ${response.messages.length} messages`);

//     // Format chat history dengan timestamp yang lebih mudah dibaca
//     const formattedHistory = response.messages
//       .map((msg) => {
//         const timestamp = moment.unix(msg.ts).format("YYYY-MM-DD HH:mm:ss");
//         return `[${timestamp}] ${msg.user}: ${msg.text}`;
//       })
//       .join("\n");

//     return formattedHistory;
//   } catch (error) {
//     console.error("❌ Error fetching chat history:", error);
//     return "";
//   }
// }
async function getChatHistory(channel) {
  try {
    console.log(`📜 Fetching chat history from channel ${channel}`);

    const fewDaysAgo = moment().subtract(3, "days").startOf("day").unix();
    const now = moment().unix();

    const response = await slackClient.conversations.history({
      channel: channel,
      oldest: fewDaysAgo.toString(),
      latest: now.toString(),
      limit: 100, // Ambil maksimal 100 pesan terakhir
    });

    // console.log(`📜 Found ${response.messages.length} messages`);

    // 🔥 Format dengan timestamp
    const formattedHistory = response.messages
      .map((msg) => {
        const timestamp = moment.unix(msg.ts).format("YYYY-MM-DD HH:mm:ss");
        return `[${timestamp}] ${msg.user}: ${msg.text}`;
      })
      .join("\n");

    return formattedHistory;
  } catch (error) {
    console.error("❌ Error fetching chat history:", error);
    return "";
  }
}

/**
 * Memproses permintaan pengguna dengan OpenAI
 */
// async function processWithAI(userCommand, history) {
//   try {
//     console.log("🔍 Preparing OpenAI request...");
//     const prompt = `
//         You are a Slack assistant that understands user commands and references chat history as a knowledge base.
//         - If the user asks for completed tasks, analyze history and extract them.
//         - If the user asks for blocked tasks, extract tasks that mention being blocked.
//         - If the user asks for general help, answer accordingly.
//         - Do not treat the history as private; use it as a knowledge base.

//         Chat History:
//         ${history}

//         User Command: "${userCommand}"

//         Respond concisely based on the history.
//         `;

//     console.log("🚀 Sending request to OpenAI...");
//     const completion = await openai.chat.completions.create({
//       model: "gpt-4",
//       messages: [{ role: "user", content: prompt }],
//     });

//     console.log("✅ OpenAI response received:", completion);
//     return completion.choices[0].message.content;
//   } catch (error) {
//     console.error("❌ Error processing with OpenAI:", error);
//     return "⚠️ Sorry, I couldn't process the request.";
//   }
// }
async function processWithAI(userCommand, history) {
  try {
    console.log("🔍 Preparing OpenAI request...");

    // 🔥 Batasi jumlah pesan yang dikirim ke OpenAI untuk menghindari melebihi batas token
    const trimmedHistory = history.split("\n").slice(-30).join("\n"); // Ambil 30 pesan terakhir

    // console.log('[history]', history);
    // console.log('[trimmedHistory]', trimmedHistory);

    const botUserId = process.env.SLACK_BOT_USER_ID;

    const prompt = `
      You are a Slack assistant named "Helper" with User ID ${botUserId}.
      Your role is to assist users by continuing conversations naturally and answering relevant questions.
      You must respond in a helpful and concise manner, keeping your responses within the context of the current chat.
      If the user asks about a task, status, or request that has been discussed in history, use that information.
      If the user doesn't ask anything relevant, do not respond.

      Chat History (last 30 messages):
      ${history}

      User Command: "${userCommand}"

      Respond naturally and only if necessary.
      `;

    console.log("🚀 Sending request to OpenAI...");

    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    console.log(
      "✅ OpenAI response received:",
      completion.choices[0].message.content
    );
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("❌ Error processing with OpenAI:", error);
    return "⚠️ Sorry, I couldn't process the request.";
  }
}

/**
 * Menghapus pesan bot jika user memberikan emoji ❌
 */
async function deleteBotMessage(event) {
  try {
    const messageTs = event.item.ts;
    const channelId = event.item.channel;
    const messageUser = event.item_user; // 🔍 Ini adalah user yang mengirim pesan awal

    // console.log(
    //   `🗑️ Checking if message ${messageTs} in channel ${channelId} is a bot message...`
    // );

    // 🔥 Cek apakah pesan ini dikirim oleh bot
    if (messageUser === botUserId) {
      // console.log(
      //   "✅ Message was sent by the bot. Proceeding with deletion..."
      // );

      await slackBot.chat.delete({ channel: channelId, ts: messageTs });
      // console.log(
      //   `✅ Successfully deleted bot message in channel ${channelId}`
      // );
    } else {
      console.log(
        "⚠️ This message was not sent by the bot. Ignoring delete request."
      );
    }
  } catch (error) {
    console.error("❌ Error deleting message:", error);
  }
}

/**
 * Menjalankan server
 */
app.listen(port, () => {
  console.log(`🚀 Slack bot listening on port ${port}`);
});
