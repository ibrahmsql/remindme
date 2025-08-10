// Firefox compatible API wrapper
const chromeAPI = {
  storage: {
    local: {
      get: (key) => browser.storage.local.get(key),
      set: (obj) => browser.storage.local.set(obj)
    }
  },
  runtime: {
    sendMessage: (msg, callback) => {
      browser.runtime.sendMessage(msg).then(callback).catch(err => {
        console.error('Message error:', err);
        if (callback) callback({ status: 'error', message: err.message });
      });
    }
  }
};

// Chrome API'sini Firefox için override et
if (typeof chrome === 'undefined') {
  window.chrome = chromeAPI;
}

function normalizeUrl(input) {
  let url = input.trim();
  if (!/^(https?:\/\/)/i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

function isLikelyUrl(input) {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (s.indexOf(".") === -1) return false;
  return /^(https?:\/\/)?[^\s]+\.[^\s]+$/i.test(s);
}

function toLocalInput(ms) {
  const d = new Date(ms);
  const localMs = d.getTime() - d.getTimezoneOffset() * 60000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function fromLocalInput(str) {
  return new Date(str).getTime();
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

function getSectionStates() {
  return new Promise(r =>
    chrome.storage.local.get("sectionStates").then(d =>
      r(d.sectionStates || { activeTab: "url", subTab: "futureUrl" })
    )
  );
}

function saveSectionStates(s) {
  chrome.storage.local.set({ sectionStates: s });
}

function showConfirm(msg, isError = false) {
  const el = document.getElementById("confirmationMessage");
  el.textContent = msg;
  el.style.color = isError ? "#eb6f92" : "#9ccfd8";
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => (el.textContent = ""), 3000);
}

function fetchReminders() {
  return new Promise(r =>
    chrome.storage.local.get("reminders").then(d =>
      r(d.reminders || { url: {}, notes: {} })
    )
  );
}

function setAllReminders(obj) {
  return chrome.storage.local.set({ reminders: obj });
}

function getRepeatText(repeatType) {
  switch(repeatType) {
    case 'daily': return 'Daily';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    default: return '';
  }
}

function makeNode(hash, entry) {
  const div = document.createElement("div");
  div.className = "reminder";
  let display;
  if (entry.url) {
    const href = normalizeUrl(entry.url);
    display = `<a class="reminder-link" href="${href}" target="_blank">${entry.url}</a>`;
  } else {
    display = `<span class="reminder-text">${entry.text}</span>`;
  }
  
  const repeatText = entry.repeatType && entry.repeatType !== 'none' ? 
    `<span class="repeat-info">(${getRepeatText(entry.repeatType)})</span>` : '';
  
  div.innerHTML = `
    ${display}
    <span class="reminder-time">${formatDateTime(entry.ts)} ${repeatText}</span>
    <textarea class="editText" rows="2">${entry.text || ""}</textarea>
    <input class="editTime" type="datetime-local" value="${toLocalInput(entry.ts)}" />
    <select class="editRepeat">
      <option value="none" ${(!entry.repeatType || entry.repeatType === 'none') ? 'selected' : ''}>Tekrar Yok</option>
      <option value="daily" ${entry.repeatType === 'daily' ? 'selected' : ''}>Günlük</option>
      <option value="weekly" ${entry.repeatType === 'weekly' ? 'selected' : ''}>Haftalık</option>
      <option value="monthly" ${entry.repeatType === 'monthly' ? 'selected' : ''}>Aylık</option>
    </select>
    <button class="update" data-hash="${hash}">Update</button>
    <button class="delete" data-hash="${hash}">Delete</button>
  `;
  div.querySelector(".update").onclick = onUpdate;
  div.querySelector(".delete").onclick = onDelete;
  return div;
}

async function loadReminders() {
  const all = await fetchReminders();
  const now = Date.now();
  ["pastUrlList", "futureUrlList", "pastNoteList", "futureNoteList"].forEach(id => {
    document.getElementById(id).innerHTML = "";
  });
  Object.entries(all.url).forEach(([h, e]) => {
    const container = e.ts > now
      ? document.getElementById("futureUrlList")
      : document.getElementById("pastUrlList");
    container.appendChild(makeNode(h, e));
  });
  Object.entries(all.notes).forEach(([h, e]) => {
    const container = e.ts > now
      ? document.getElementById("futureNoteList")
      : document.getElementById("pastNoteList");
    container.appendChild(makeNode(h, e));
  });
}

async function activateTab(mainTab, subTab = null) {
  document.querySelectorAll(".main-tab-header").forEach(h => h.classList.remove("active"));
  document.querySelector(`[data-tab="${mainTab}"]`).classList.add("active");
  document.querySelector(".url-section").style.display = mainTab === "url" ? "flex" : "none";
  document.querySelector(".note-section").style.display = mainTab === "notes" ? "flex" : "none";
  document.querySelector(".url-sub-tabs").style.display = mainTab === "url" ? "flex" : "none";
  document.querySelector(".note-sub-tabs").style.display = mainTab === "notes" ? "flex" : "none";
  
  const defaultSubTab = subTab || (mainTab === "url" ? "futureUrl" : "futureNote");
  document.querySelectorAll(".sub-tab-header").forEach(h => h.classList.remove("active"));
  document.querySelector(`[data-tab="${defaultSubTab}"]`).classList.add("active");
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  document.getElementById(`${defaultSubTab}List`).classList.add("active");
  
  const states = await getSectionStates();
  states.activeTab = mainTab;
  states.subTab = defaultSubTab;
  saveSectionStates(states);
}

document.getElementById("setUrlReminder").onclick = () => {
  const url = document.getElementById("url").value.trim();
  const time = document.getElementById("urlReminderTime").value;
  const text = document.getElementById("urlReminderText").value.trim();
  const repeatType = document.getElementById("urlRepeatType").value;
  if (!url) {
    showConfirm("Please enter a URL", true);
    return;
  }
  if (!time) {
    showConfirm("Please select a time", true);
    return;
  }
  const ms = fromLocalInput(time);
  if (ms <= Date.now()) {
    showConfirm("Please select a future time", true);
    return;
  }
  chrome.runtime.sendMessage(
    { action: "setReminder", url, time: ms, text, type: "url", repeatType },
    r => {
      if (r.status === "success") {
        showConfirm("URL reminder set!");
        document.getElementById("url").value = "";
        document.getElementById("urlReminderTime").value = "";
        document.getElementById("urlReminderText").value = "";
        document.getElementById("urlRepeatType").value = "none";
        loadReminders();
      } else {
        showConfirm(r.message, true);
      }
    }
  );
};

document.getElementById("setNoteReminder").onclick = () => {
  const time = document.getElementById("noteReminderTime").value;
  const text = document.getElementById("noteReminderText").value.trim();
  const repeatType = document.getElementById("noteRepeatType").value;
  if (!text) {
    showConfirm("Please enter a note", true);
    return;
  }
  if (!time) {
    showConfirm("Please select a time", true);
    return;
  }
  const ms = fromLocalInput(time);
  if (ms <= Date.now()) {
    showConfirm("Please select a future time", true);
    return;
  }
  chrome.runtime.sendMessage(
    { action: "setReminder", time: ms, text, type: "notes", repeatType },
    r => {
      if (r.status === "success") {
        showConfirm("Note reminder set!");
        document.getElementById("noteReminderTime").value = "";
        document.getElementById("noteReminderText").value = "";
        document.getElementById("noteRepeatType").value = "none";
        loadReminders();
      } else {
        showConfirm(r.message, true);
      }
    }
  );
};

async function onUpdate(e) {
  const hash = e.target.dataset.hash;
  const reminder = e.target.closest(".reminder");
  const newText = reminder.querySelector(".editText").value;
  const newTimeStr = reminder.querySelector(".editTime").value;
  const newRepeatType = reminder.querySelector(".editRepeat").value;
  if (!newTimeStr) {
    showConfirm("Please enter a valid time", true);
    return;
  }
  const newTime = fromLocalInput(newTimeStr);
  const all = await fetchReminders();
  let type = null;
  let entry = null;
  for (const t of ["url", "notes"]) {
    if (all[t]?.[hash]) {
      type = t;
      entry = all[t][hash];
      break;
    }
  }
  if (!entry) {
    showConfirm("Reminder not found", true);
    return;
  }
  entry.text = newText;
  entry.ts = newTime;
  entry.repeatType = newRepeatType;
  await setAllReminders(all);
  chrome.runtime.sendMessage(
    { action: "updateReminder", hash, url: entry.url, time: newTime, text: newText, type, repeatType: newRepeatType },
    r => {
      if (r.status === "success") {
        showConfirm("Reminder updated!");
        loadReminders();
      } else {
        showConfirm(r.message, true);
      }
    }
  );
}

async function onDelete(e) {
  const hash = e.target.dataset.hash;
  const all = await fetchReminders();
  let type = null;
  for (const t of ["url", "notes"]) {
    if (all[t]?.[hash]) {
      type = t;
      break;
    }
  }
  if (!type) {
    showConfirm("Reminder not found", true);
    return;
  }
  chrome.runtime.sendMessage(
    { action: "deleteReminder", hash, type },
    r => {
      if (r.status === "success") {
        showConfirm("Reminder deleted!");
        loadReminders();
      } else {
        showConfirm(r.message, true);
      }
    }
  );
}

const blurContainer = document.querySelector(".blur-container");
const nukeModal = document.getElementById("nukeModal");
const btnNukeAll = document.getElementById("nukeAll");
const btnYes = nukeModal.querySelector("button.yes");
const btnNo  = nukeModal.querySelector("button.no");

btnNukeAll.addEventListener("click", () => {
  blurContainer.classList.add("blur-active");
  nukeModal.style.display = "block";
});
btnNo.addEventListener("click", () => {
  blurContainer.classList.remove("blur-active");
  nukeModal.style.display = "none";
});
btnYes.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "nukeAllReminders" }, r => {
    if (r.status === "success") {
      showConfirm("All reminders deleted!");
      loadReminders();
    } else {
      showConfirm(r.message, true);
    }
    blurContainer.classList.remove("blur-active");
    nukeModal.style.display = "none";
  });
});

document.querySelectorAll(".main-tab-header").forEach(h => {
  h.onclick = () => {
    const tab = h.dataset.tab;
    activateTab(tab);
  };
});
document.querySelectorAll(".sub-tab-header").forEach(h => {
  h.onclick = async () => {
    const subTab = h.dataset.tab;
    const states = await getSectionStates();
    activateTab(states.activeTab, subTab);
  };
});

document.addEventListener("DOMContentLoaded", async () => {
  const states = await getSectionStates();
  activateTab(states.activeTab, states.subTab);
  loadReminders();
});