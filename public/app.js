const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const deleteChatBtn = document.getElementById("deleteChatBtn");

// ✅ NEW UI
const newChatBtn = document.getElementById("newChatBtn");
const chatSelect = document.getElementById("chatSelect");

// ===============================
// ✅ NEW: ניהול צ'אטים בדפדפן
// ===============================
const STORAGE_KEY = "multiChats_v1";

/**
 * state = {
 *   activeChatId: string,
 *   chats: {
 *     [chatId]: { title: string, messages: Array<{who:"me"|"bot", text:string}> }
 *   }
 * }
 */
let state = loadState();

// יצירת מזהה ייחודי לצ'אט
function makeId() {
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  // ברירת מחדל: צ'אט ראשון
  const firstId = makeId();
  const initial = {
    activeChatId: firstId,
    chats: {
      [firstId]: {
        title: "צ'אט 1",
        messages: [],
      },
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveChat() {
  return state.chats[state.activeChatId];
}

function clearChatUI() {
  chat.innerHTML = "";
}

function addBubble(text, who = "me") {
  const div = document.createElement("div");
  div.className = `bubble ${who}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function renderActiveChat() {
  clearChatUI();
  const active = getActiveChat();
  for (const m of active.messages) {
    addBubble(m.text, m.who);
  }
}

function renderChatSelect() {
  chatSelect.innerHTML = "";
  const entries = Object.entries(state.chats);

  entries.forEach(([id, chatObj], idx) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = chatObj.title || `צ'אט ${idx + 1}`;
    if (id === state.activeChatId) opt.selected = true;
    chatSelect.appendChild(opt);
  });
}

function renameChatIfFirstMessage(chatId, firstUserMessage) {
  const c = state.chats[chatId];
  if (!c) return;
  if (c.messages.length === 1 && c.title.startsWith("צ'אט")) {
    // שם אוטומטי לפי תחילת ההודעה
    c.title =
      firstUserMessage.slice(0, 18) + (firstUserMessage.length > 18 ? "…" : "");
  }
}

// ===============================
// ✅ NEW: יצירת צ'אט חדש + מעבר צ'אטים
// ===============================
newChatBtn.addEventListener("click", () => {
  const newId = makeId();
  const count = Object.keys(state.chats).length + 1;

  state.chats[newId] = { title: `צ'אט ${count}`, messages: [] };
  state.activeChatId = newId;

  saveState();
  renderChatSelect();
  renderActiveChat();
  input.focus();
});

chatSelect.addEventListener("change", () => {
  state.activeChatId = chatSelect.value;
  saveState();
  renderActiveChat();
  input.focus();
});

deleteChatBtn.addEventListener("click", async () => {
  const activeId = state.activeChatId;

  if (!activeId || !state.chats[activeId]) return;

  const ok = confirm("למחוק את הצ'אט הנוכחי? הפעולה לא ניתנת לשחזור.");
  if (!ok) return;

  // ✅ מחיקה מהשרת - אם לא קיים שם (404) זה עדיין בסדר
  try {
    const r = await fetch(`/api/chat/${activeId}`, { method: "DELETE" });

    // 404 = השרת לא מכיר את הצ'אט (אחרי redeploy/עוד לא נוצר) => לא חוסם מחיקה מקומית
    if (!r.ok && r.status !== 404) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || "Failed to delete chat on server");
    }
  } catch (err) {
    alert("שגיאה במחיקה מהשרת: " + err.message);
    return;
  }

  // ✅ מחיקה מקומית (LocalStorage)
  delete state.chats[activeId];

  const remainingIds = Object.keys(state.chats);

  // אם מחקנו את הצ'אט האחרון - יוצרים חדש
  if (remainingIds.length === 0) {
    const newId = makeId();
    state.chats[newId] = { title: "צ'אט 1", messages: [] };
    state.activeChatId = newId;
  } else {
    state.activeChatId = remainingIds[0];
  }

  saveState();
  renderChatSelect();
  renderActiveChat();
  input.focus();
});

// רינדור ראשוני
renderChatSelect();
renderActiveChat();

// ===============================
// שליחה וקבלת תשובה (עם chatId)
// ===============================
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = input.value.trim();
  if (!msg) return;

  const activeId = state.activeChatId;
  const activeChat = getActiveChat();

  // ✅ שמירה מקומית של הודעת משתמש (היסטוריה בדפדפן)
  activeChat.messages.push({ who: "me", text: msg });
  renameChatIfFirstMessage(activeId, msg);

  saveState();
  renderChatSelect();
  addBubble(msg, "me");

  input.value = "";
  input.focus();
  sendBtn.disabled = true;

  try {
    // ✅ NEW: שולחים גם chatId לשרת
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeId, message: msg }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || "Request failed");

    // ✅ שמירה מקומית של תשובת הבוט (היסטוריה בדפדפן)
    activeChat.messages.push({ who: "bot", text: data.reply });

    saveState();
    addBubble(data.reply, "bot");
  } catch (err) {
    const errorMsg = "שגיאה: " + err.message;
    activeChat.messages.push({ who: "bot", text: errorMsg });
    saveState();
    addBubble(errorMsg, "bot");
  } finally {
    sendBtn.disabled = false;
  }
});
