import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// מגיש את תיקיית public (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, "public")));

// ✅ OpenAI client
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Health check
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// ===============================
// ✅ NEW: ניהול צ'אטים והיסטוריה
// ===============================
/**
 * chats = Map<chatId, Array<{role: "system"|"user"|"assistant", content: string}>>
 * כל chatId שומר מערך messages של שיחה אחת.
 */
const chats = new Map();

//הגדרת פרומפט מערכת וקבועים להיסטוריית הצ'אט
// ✅ NEW: קבועים לשליטה על גודל ההיסטוריה (כדי לא להתפוצץ בטוקנים)
const SYSTEM_PROMPT = "אתה צ'אטבוט עוזר, ענה בקצרה וברורה.";
const MAX_TURNS = 20; // כמה זוגות user+assistant נשמור

function getOrCreateChat(chatId) {
  if (!chats.has(chatId)) {
    chats.set(chatId, [{ role: "system", content: SYSTEM_PROMPT }]);
  }
  return chats.get(chatId);
}

function trimHistory(messages) {
  // משאירים system + אחריו עד MAX_TURNS*2 הודעות (user+assistant)
  const system = messages[0]?.role === "system" ? [messages[0]] : [];
  const rest = messages.filter((m) => m.role !== "system");

  const maxMsgs = MAX_TURNS * 2;
  const trimmedRest = rest.slice(-maxMsgs);

  return [...system, ...trimmedRest];
}
// ===============================
// ✅ NEW: מחיקת צ'אט מהשרת
// ===============================
app.delete("/api/chat/:chatId", (req, res) => {
  const { chatId } = req.params;

  if (!chatId) {
    return res.status(400).json({ error: "chatId is required" });
  }

  if (!chats.has(chatId)) {
    return res.status(404).json({ error: "Chat not found" });
  }

  chats.delete(chatId);
  res.json({ ok: true });
});

// (לא חובה, אבל נחמד) לראות אילו צ'אטים קיימים בזיכרון השרת
app.get("/api/chats", (req, res) => {
  res.json({ chatIds: Array.from(chats.keys()) });
});

app.post("/api/chat", async (req, res) => {
  try {
    // ✅ NEW: מקבלים גם chatId
    const { chatId, message } = req.body || {};

    if (!chatId || typeof chatId !== "string") {
      return res.status(400).json({ error: "chatId is required" });
    }
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    // ✅ NEW: טוענים/יוצרים היסטוריה לצ'אט הזה
    const history = getOrCreateChat(chatId);

    // מוסיפים הודעת משתמש להיסטוריה
    history.push({ role: "user", content: message });

    // חותכים היסטוריה אם גדלה מדי
    const trimmed = trimHistory(history);
    chats.set(chatId, trimmed);

    // ✅ NEW: קריאה עם messages (היסטוריה) כדי לקבל שיחה מתמשכת
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chats.get(chatId),
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || "";

    // מוסיפים תשובת בוט להיסטוריה
    const updated = chats.get(chatId);
    updated.push({ role: "assistant", content: reply });

    // חותכים שוב אם צריך
    chats.set(chatId, trimHistory(updated));

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// מאזין על פורט
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log("Server listening on port", port);
});
