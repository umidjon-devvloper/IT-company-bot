const mongoose = require("mongoose");

const surveySchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  username: { type: String, default: "" },
  firstName: { type: String, default: "" },

  // Tadbirkor bog'lanishi
  inn: { type: String, default: null, index: true },
  innVerified: { type: Boolean, default: false },
  entrepreneurId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Entrepreneur",
    default: null,
  },

  // Bot holati — server restart bo'lsa ham saqlanadi
  // waiting_inn | inn_confirmed | in_survey | done
  state: { type: String, default: "waiting_inn" },

  answers: {
    q1: { type: String, default: null },
    q2: { type: String, default: null },
    q3: { type: String, default: null },
    q4: { type: String, default: null },
    q5: { type: String, default: null },
    q6: { type: String, default: null },
    q7: { type: String, default: null },
    q8: { type: String, default: null },
    q9: { type: String, default: null },
    q10: { type: String, default: null },
  },
  currentQuestion: { type: Number, default: 1 },
  lastMessageId: { type: Number, default: null },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Survey", surveySchema);
