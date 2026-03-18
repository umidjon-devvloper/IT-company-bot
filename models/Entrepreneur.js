const mongoose = require("mongoose");

const entrepreneurSchema = new mongoose.Schema({
  inn: { type: String, required: true, unique: true, index: true }, // STIR
  companyName: { type: String, default: "" }, // Korxona nomi
  address: { type: String, default: "" }, // Manzili
  districtName: { type: String, default: "" }, // Tuman nomi
  mfyName: { type: String, default: "" }, // MFY nomi
  streetName: { type: String, default: "" }, // Ko'cha nomi
  phone: { type: String, default: "" }, // Tel raqami
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Entrepreneur", entrepreneurSchema);
