require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const connectDB = require("./config/db");
const Survey = require("./models/Survey");
const User = require("./models/User");
const questions = require("./questions");

connectDB();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ─── Qo'llanma matni ─────────────────────────────────────────────────────────

const GUIDE_TEXT = `📋 *SO'ROVNOMA QOIDALARI*

Assalomu alaykum! Ushbu bot orqali so'rovnomani to'ldirishingiz mumkin.

*Qanday ishlaydi:*
1️⃣ \`/start\` bosing — botni ishga tushiradi
2️⃣ *"▶️ Boshlash"* tugmasini bosing
3️⃣ Har bir savolga javob variantlaridan birini tanlang (A, B, C yoki D)
4️⃣ 10-savol matn ko'rinishida — fikr-mulohazangizni yozing va yuboring
5️⃣ So'rovnoma tugagach rahmat xabari keladi ✅

*Muhim:*
• Savollarni o'tkazib bo'lmaydi
• Bir marta to'ldirilgandan keyin qayta to'ldirish mumkin emas
• Agar xato bosilsa bot o'z-o'zidan keyingisiga o'tadi

*Muammo bo'lsa:* \`/start\` bosing — davom ettiradi 🔄`;

// ─── Helpers ────────────────────────────────────────────────────────────────

// Buttonlar faqat A B C D — bitta qatorda
function buildInlineKeyboard(options) {
  return {
    inline_keyboard: [
      options.map((opt) => ({
        text: opt.label,
        callback_data: `ans_${opt.label}`,
      })),
    ],
  };
}

// Savol matni + variant matnlari xabarda to'liq ko'rinadi
function buildQuestionText(question) {
  const optLines = question.options
    .map((o) => `${o.label}) ${o.text}`)
    .join("\n\n");
  return `${question.text}\n\n${optLines}`;
}

async function sendQuestion(chatId, questionIndex) {
  const question = questions[questionIndex];
  if (!question) return;

  if (question.type === "choice") {
    const sent = await bot.sendMessage(chatId, buildQuestionText(question), {
      reply_markup: buildInlineKeyboard(question.options),
    });
    return sent.message_id;
  } else {
    const sent = await bot.sendMessage(
      chatId,
      question.text + "\n\nJavobingizni matn ko'rinishida yozing.",
    );
    return sent.message_id;
  }
}

async function deleteMessage(chatId, messageId) {
  try {
    if (messageId) await bot.deleteMessage(chatId, messageId);
  } catch (e) {}
}

async function sendAndPinGuide(chatId) {
  try {
    const sent = await bot.sendMessage(chatId, GUIDE_TEXT, {
      parse_mode: "Markdown",
    });
    await bot.pinChatMessage(chatId, sent.message_id, {
      disable_notification: true,
    });
  } catch (e) {}
}

// ─── /start command ──────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || "";
  const firstName = msg.from.first_name || "";
  const lastName = msg.from.last_name || "";
  const languageCode = msg.from.language_code || "";

  try {
    await User.findOneAndUpdate(
      { chatId },
      {
        chatId,
        username,
        firstName,
        lastName,
        languageCode,
        lastActive: new Date(),
      },
      { upsert: true, returnDocument: "after" },
    );

    let survey = await Survey.findOne({ chatId });

    if (survey && survey.completed) {
      return bot.sendMessage(
        chatId,
        "Siz so'rovnomani allaqachon to'ldirgansiz. Rahmat! 🎉",
      );
    }

    if (survey && !survey.completed) {
      await bot.sendMessage(
        chatId,
        `So'rovnomani davom ettiramiz, ${firstName}...`,
      );
      const msgId = await sendQuestion(chatId, survey.currentQuestion - 1);
      survey.lastMessageId = msgId;
      await survey.save();
      return;
    }

    await sendAndPinGuide(chatId);
    survey = await Survey.create({ chatId, username, firstName });

    await bot.sendMessage(
      chatId,
      `Assalomu alaykum, ${firstName}!\n\nSo'rovnomaga xush kelibsiz. Ishtirok etish uchun quyidagi tugmani bosing.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "▶️ Boshlash", callback_data: "start_survey" }],
          ],
        },
      },
    );
  } catch (err) {
    console.error("/start error:", err);
    await bot.sendMessage(
      chatId,
      "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
    );
  }
});

// ─── /qollanma command ───────────────────────────────────────────────────────

bot.onText(/\/qollanma/, async (msg) => {
  await bot.sendMessage(msg.chat.id, GUIDE_TEXT, { parse_mode: "Markdown" });
});

// ─── Callback query handler ──────────────────────────────────────────────────

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;

  await bot.answerCallbackQuery(query.id);

  try {
    if (data === "start_survey") {
      const survey = await Survey.findOne({ chatId });
      if (!survey || survey.completed) return;

      await deleteMessage(chatId, messageId);
      const newMsgId = await sendQuestion(chatId, 0);
      survey.lastMessageId = newMsgId;
      await survey.save();
      return;
    }

    if (data.startsWith("ans_")) {
      const selectedOption = data.replace("ans_", "");
      const survey = await Survey.findOne({ chatId });

      if (!survey || survey.completed) return;

      const currentIndex = survey.currentQuestion - 1;
      const currentQuestion = questions[currentIndex];
      if (!currentQuestion || currentQuestion.type !== "choice") return;

      const selectedFull = currentQuestion.options.find(
        (o) => o.label === selectedOption,
      );
      survey.answers[`q${currentQuestion.id}`] = selectedFull
        ? `${selectedFull.label}) ${selectedFull.text}`
        : selectedOption;

      const nextQuestionNumber = survey.currentQuestion + 1;
      survey.currentQuestion = nextQuestionNumber;

      await deleteMessage(chatId, messageId);

      if (nextQuestionNumber > questions.length) {
        await survey.save();
        await finishSurvey(chatId, survey);
      } else {
        const newMsgId = await sendQuestion(chatId, nextQuestionNumber - 1);
        survey.lastMessageId = newMsgId;
        await survey.save();
      }
    }
  } catch (err) {
    console.error("callback_query error:", err);
  }
});

// ─── Text message handler (question 10) ──────────────────────────────────────

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const chatId = msg.chat.id;

  try {
    const survey = await Survey.findOne({ chatId });
    if (!survey || survey.completed) return;

    const currentQuestion = questions[survey.currentQuestion - 1];
    if (!currentQuestion || currentQuestion.type !== "text") return;

    await deleteMessage(chatId, survey.lastMessageId);
    await deleteMessage(chatId, msg.message_id);

    survey.answers[`q${currentQuestion.id}`] = msg.text.trim();
    survey.currentQuestion += 1;
    await survey.save();

    await finishSurvey(chatId, survey);
  } catch (err) {
    console.error("message handler error:", err);
  }
});

// ─── Finish survey ───────────────────────────────────────────────────────────

async function finishSurvey(chatId, survey) {
  try {
    survey.completed = true;
    await survey.save();
    await bot.sendMessage(
      chatId,
      "✅ So'rovnomada ishtirok etganingiz uchun rahmat!\n\nJavoblaringiz saqlandi.",
    );
  } catch (err) {
    console.error("finishSurvey error:", err);
  }
}

console.log("Bot is running...");
