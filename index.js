require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const connectDB = require("./config/db");
const Survey = require("./models/Survey");
const User = require("./models/User");
const Entrepreneur = require("./models/Entrepreneur");
const questions = require("./questions");

connectDB();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ─── HTML escape ──────────────────────────────────────────────────────────────
function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Qo'llanma ───────────────────────────────────────────────────────────────
const GUIDE_TEXT = `📋 <b>SO'ROVNOMA QOIDALARI</b>

Assalomu alaykum! Ushbu bot orqali so'rovnomani to'ldirishingiz mumkin.

<b>Qanday ishlaydi:</b>
1️⃣ /start bosing — botni ishga tushiradi
2️⃣ INN (STIR) raqamingizni yuboring
3️⃣ <b>▶️ Boshlash</b> tugmasini bosing
4️⃣ Har bir savolga javob variantlaridan birini tanlang (A, B, C yoki D)
5️⃣ 10-savol matn ko'rinishida — fikr-mulohazangizni yozing va yuboring
6️⃣ So'rovnoma tugagach rahmat xabari keladi ✅

<b>Muhim:</b>
• Faqat ro'yxatdagi tadbirkorlar ishtirok eta oladi
• Savollarni o'tkazib bo'lmaydi
• Bir marta to'ldirilgandan keyin qayta to'ldirish mumkin emas

<b>Muammo bo'lsa:</b> /start bosing — davom ettiradi 🔄`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
      parse_mode: "HTML",
    });
    await bot.pinChatMessage(chatId, sent.message_id, {
      disable_notification: true,
    });
  } catch (e) {}
}

// ─── /start ───────────────────────────────────────────────────────────────────
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

    const survey = await Survey.findOne({ chatId });

    // Tugatgan
    if (survey && survey.completed) {
      return bot.sendMessage(
        chatId,
        "Siz so'rovnomani allaqachon to'ldirgansiz. Rahmat! 🎉",
      );
    }

    // INN tasdiqlangan, so'rovnoma davom etmoqda
    if (survey && !survey.completed && survey.innVerified) {
      await bot.sendMessage(
        chatId,
        `So'rovnomani davom ettiramiz, ${esc(firstName)}...`,
      );
      const msgId = await sendQuestion(chatId, survey.currentQuestion - 1);
      survey.lastMessageId = msgId;
      // state ni DB ga ham yozamiz
      survey.state = "in_survey";
      await survey.save();
      return;
    }

    // Yangi yoki INN tasdiqlanmagan — INN so'raymiz
    // Survey yo'q bo'lsa yaratamiz (state = waiting_inn)
    if (!survey) {
      await Survey.create({
        chatId,
        username,
        firstName,
        state: "waiting_inn",
      });
    } else {
      // INN tasdiqlanmagan, qayta so'raymiz
      await Survey.updateOne({ chatId }, { $set: { state: "waiting_inn" } });
    }

    await sendAndPinGuide(chatId);

    await bot.sendMessage(
      chatId,
      `Assalomu alaykum, ${esc(firstName)}! 👋\n\nSo'rovnomada ishtirok etish uchun <b>INN (STIR) raqamingizni</b> yuboring:`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    console.error("/start error:", err);
    await bot.sendMessage(
      chatId,
      "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
    );
  }
});

// ─── /qollanma ────────────────────────────────────────────────────────────────
bot.onText(/\/qollanma/, async (msg) => {
  await bot.sendMessage(msg.chat.id, GUIDE_TEXT, { parse_mode: "HTML" });
});

// ─── Callback query ───────────────────────────────────────────────────────────
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
      survey.state = "in_survey";
      await survey.save();

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

// ─── Message handler ──────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  try {
    const survey = await Survey.findOne({ chatId });
    if (!survey || survey.completed) return;

    // ── INN kutilmoqda (state DB dan o'qiladi) ──
    if (survey.state === "waiting_inn") {
      await deleteMessage(chatId, msg.message_id);

      if (!/^\d{9}$/.test(text)) {
        return bot.sendMessage(
          chatId,
          "⚠️ INN noto'g'ri formatda. INN 9 ta raqamdan iborat bo'lishi kerak.\n\nQaytadan yuboring:",
        );
      }

      const entrepreneur = await Entrepreneur.findOne({ inn: text });

      if (!entrepreneur) {
        return bot.sendMessage(
          chatId,
          `❌ <b>${esc(text)}</b> INN raqami ro'yxatda topilmadi.\n\nIltimos, to'g'ri INN raqamini yuboring:`,
          { parse_mode: "HTML" },
        );
      }

      // INN topildi — surveiga saqlаymiz
      survey.inn = text;
      survey.innVerified = true;
      survey.entrepreneurId = entrepreneur._id;
      survey.state = "inn_confirmed";
      await survey.save();

      await bot.sendMessage(
        chatId,
        `✅ <b>INN tasdiqlandi!</b>\n\n🏢 <b>Korxona:</b> ${esc(entrepreneur.companyName)}\n📍 <b>Tuman:</b> ${esc(entrepreneur.districtName)}\n🏘 <b>MFY:</b> ${esc(entrepreneur.mfyName)}\n\nSo'rovnomani boshlash uchun tugmani bosing:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "▶️ Boshlash", callback_data: "start_survey" }],
            ],
          },
        },
      );
      return;
    }

    
    // ── 10-savol matn javobi ──
    if (survey.state === "in_survey") {
      const currentQuestion = questions[survey.currentQuestion - 1];
      if (!currentQuestion || currentQuestion.type !== "text") return;

      await deleteMessage(chatId, survey.lastMessageId);
      await deleteMessage(chatId, msg.message_id);

      survey.answers[`q${currentQuestion.id}`] = text;
      survey.currentQuestion += 1;
      await survey.save();

      await finishSurvey(chatId, survey);
    }
  } catch (err) {
    console.error("message handler error:", err);
  }
});

// ─── Finish survey ────────────────────────────────────────────────────────────
async function finishSurvey(chatId, survey) {
  try {
    survey.completed = true;
    survey.state = "done";
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
