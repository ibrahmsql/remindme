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
    chrome.storage.local.get("sectionStates", d =>
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
    chrome.storage.local.get("reminders", d =>
      r(d.reminders || { url: {}, notes: {} })
    )
  );
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
  div.innerHTML = `
    ${display}
    <span class="reminder-time">${formatDateTime(entry.ts)}</span>
    <textarea class="editText" rows="2">${entry.text || ""}</textarea>
    <input class="editTime" type="datetime-local" value="${toLocalInput(entry.ts)}" />
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
  const { activeTab, subTab } = await getSectionStates();
  activateTab(activeTab, subTab);
}

async function activateTab(mainTab, subTab = null) {
  const defaultSub = mainTab === "url" ? "futureUrl" : "futureNote";
  const current = await getSectionStates();
  if (current.activeTab !== mainTab) subTab = null;
  document.querySelectorAll(".main-tab-header").forEach(h =>
    h.classList.toggle("active", h.dataset.tab === mainTab)
  );
  document.querySelectorAll(".sub-tab-header").forEach(h =>
    h.classList.toggle("active", h.dataset.tab === subTab)
  );
  document.querySelector(".url-section").style.display =
    mainTab === "url" ? "flex" : "none";
  document.querySelector(".note-section").style.display =
    mainTab === "notes" ? "flex" : "none";
  document.querySelector(".url-sub-tabs").style.display =
    mainTab === "url" ? "flex" : "none";
  document.querySelector(".note-sub-tabs").style.display =
    mainTab === "notes" ? "flex" : "none";
  document.querySelectorAll(".tab-pane").forEach(p =>
    p.classList.toggle("active", p.id === (subTab + "List"))
  );
  saveSectionStates({ activeTab: mainTab, subTab });
}

document.getElementById("setUrlReminder").onclick = () => {
  const rawUrl = document.getElementById("url").value.trim();
  const txt    = document.getElementById("urlReminderText").value.trim();
  const when   = fromLocalInput(document.getElementById("urlReminderTime").value);
  if (!when) {
    return showConfirm("Enter a valid date/time", true);
  }
  if (!isLikelyUrl(rawUrl)) {
    return showConfirm(
      "Please enter a valid URL (e.g. example.com or https://example.com)",
      true
    );
  }
  const url = normalizeUrl(rawUrl);
  chrome.runtime.sendMessage(
    { action: "setReminder", url, time: when, text: txt, type: "url" },
    res => {
      if (res.status === "success") {
        showConfirm("URL reminder set!");
        document.getElementById("url").value = "";
        document.getElementById("urlReminderTime").value = "";
        document.getElementById("urlReminderText").value = "";
        loadReminders();
      } else {
        showConfirm(res.message || "Set failed", true);
      }
    }
  );
};

document.getElementById("setNoteReminder").onclick = () => {
  const when = fromLocalInput(
    document.getElementById("noteReminderTime").value
  );
  const txt = document.getElementById("noteReminderText").value.trim();
  if (!when || !txt) {
    return showConfirm("Enter time and note", true);
  }
  chrome.runtime.sendMessage(
    { action: "setReminder", url: "", time: when, text: txt, type: "notes" },
    res => {
      if (res.status === "success") {
        showConfirm("Note reminder set!");
        document.getElementById("noteReminderTime").value = "";
        document.getElementById("noteReminderText").value = "";
        loadReminders();
      } else {
        showConfirm(res.message || "Set failed", true);
      }
    }
  );
};

async function onUpdate(e) {
  const hash = e.target.dataset.hash;
  const parent = e.target.closest(".reminder");
  const when = fromLocalInput(parent.querySelector(".editTime").value);
  const txt = parent.querySelector(".editText").value.trim();
  if (!when) {
    return showConfirm("Pick a date/time", true);
  }
  const all = await fetchReminders();
  let entry, type;
  for (let t of ["url", "notes"]) {
    if (all[t][hash]) {
      entry = all[t][hash];
      type = t;
      break;
    }
  }
  if (!entry) {
    return showConfirm("Entry missing", true);
  }
  chrome.runtime.sendMessage(
    {
      action: "updateReminder",
      url: entry.url,
      time: when,
      text: txt,
      type
    },
    res => {
      if (res.status === "success") {
        showConfirm("Updated!");
        loadReminders();
      } else {
        showConfirm("Update failed", true);
      }
    }
  );
}

async function onDelete(e) {
  const hash = e.target.dataset.hash;
  const all = await fetchReminders();
  const type = Object.keys(all).find(t => all[t][hash]);
  if (!type) {
    return showConfirm("Entry missing", true);
  }
  chrome.runtime.sendMessage(
    { action: "deleteReminder", hash, type },
    res => {
      if (res.status === "success") {
        showConfirm("Deleted!");
        loadReminders();
      } else {
        showConfirm(res.message || "Delete failed", true);
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
  nukeModal.style.display = "none";
  blurContainer.classList.remove("blur-active");
});
btnYes.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "nukeAllReminders" }, res => {
    if (res.status === "success") {
      showConfirm("All reminders gone.");
      loadReminders();
    } else {
      showConfirm(res.message || "Nuke failed", true);
    }
    nukeModal.style.display = "none";
    blurContainer.classList.remove("blur-active");
  });
});

document.querySelectorAll(".main-tab-header").forEach(h => {
  h.onclick = () => {
    const mainTab = h.dataset.tab;
    const defaultSub = mainTab === "url" ? "futureUrl" : "futureNote";
    activateTab(mainTab, defaultSub);
  };
});
document.querySelectorAll(".sub-tab-header").forEach(h => {
  h.onclick = () => {
    const mainTab = h.closest(".url-sub-tabs") ? "url" : "notes";
    activateTab(mainTab, h.dataset.tab);
  };
});

document.addEventListener("DOMContentLoaded", loadReminders);
