const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  username: { type: String, default: "" },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  languageCode: { type: String, default: "" },
  joinedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
