async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function getAllReminders() {
  return browser.storage.local.get("reminders").then(d => d.reminders || { url: {}, notes: {} });
}

function setAllReminders(obj) {
  return browser.storage.local.set({ reminders: obj });
}

function getNextRepeatTime(currentTime, repeatType) {
  const date = new Date(currentTime);
  switch(repeatType) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      return null;
  }
  return date.getTime();
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { action, url, time, text, hash, type } = msg;
  if (action === "deleteReminder" && hash && type) {
    getAllReminders().then(all => {
      if (all[type]?.[hash]) {
        delete all[type][hash];
        return setAllReminders(all).then(() => {
          browser.alarms.clear(hash);
          sendResponse({ status: "success" });
        });
      }
      sendResponse({ status: "error", message: "Reminder not found" });
    });
    return true;
  }

  if (action === "nukeAllReminders") {
    getAllReminders().then(all => {
      const keys = [...Object.keys(all.url), ...Object.keys(all.notes)];
      keys.forEach(k => browser.alarms.clear(k));
      return setAllReminders({ url: {}, notes: {} });
    }).then(() => sendResponse({ status: "success" }));
    return true;
  }

  if (!time) {
    sendResponse({ status: "error", message: "No time provided" });
    return;
  }

  sha256Hex(url || text).then(async urlHash => {
    const all = await getAllReminders();
    if (action === "setReminder" || action === "updateReminder") {
      all[type] = all[type] || {};
      all[type][urlHash] = { 
        url: url || "", 
        ts: time, 
        text: text || "", 
        fired: false,
        repeatType: msg.repeatType || "none",
        originalTime: time
      };
      await setAllReminders(all);
      browser.alarms.clear(urlHash).then(() => browser.alarms.create(urlHash, { when: time }));
      sendResponse({ status: "success", hash: urlHash });
      return;
    }
    sendResponse({ status: "error", message: "Unknown action" });
  });

  return true;
});

browser.alarms.onAlarm.addListener(async alarm => {
  const urlHash = alarm.name;
  const all = await getAllReminders();
  let entry = null;
  let entryType = null;
  for (const t of ["url", "notes"]) {
    if (all[t]?.[urlHash]) {
      entry = all[t][urlHash];
      entryType = t;
      break;
    }
  }
  if (!entry) return;
  
  const timeStr = new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  let title, message;
  if (entry.url && !entry.text) {
    title = `[remindme]`;
    message = `You were supposed to look at ${entry.url} at ${timeStr}!`;
  } else if (entry.url && entry.text) {
    title = `[remindme] You were supposed to look at ${entry.url} at ${timeStr}!`;
    message = entry.text;
  } else {
    title = `[remindme] You put a reminder for ${timeStr}!`;
    message = entry.text;
  }
  
  browser.notifications.create(urlHash, {
    type: "basic",
    iconUrl: "icon48.png",
    title,
    message
  });
  
  // Tekrarlayan hatırlatma kontrolü
  if (entry.repeatType && entry.repeatType !== 'none') {
    const nextTime = getNextRepeatTime(entry.ts, entry.repeatType);
    if (nextTime) {
      entry.ts = nextTime;
      entry.fired = false;
      await setAllReminders(all);
      browser.alarms.create(urlHash, { when: nextTime });
    }
  } else {
    entry.fired = true;
    await setAllReminders(all);
  }
});

browser.notifications.onClicked.addListener(notificationId => {
  getAllReminders().then(all => {
    for (const t of ["url", "notes"]) {
      const e = all[t]?.[notificationId];
      if (e) {
        if (e.url.startsWith("http")) browser.tabs.create({ url: e.url });
        break;
      }
    }
    browser.notifications.clear(notificationId);
  });
});

browser.runtime.onStartup.addListener(async () => {
  const all = await getAllReminders();
  const now = Date.now();
  let missed = false;
  for (const t of ["url", "notes"]) {
    for (const k in all[t]) {
      if (all[t][k].ts < now && !all[t][k].fired) {
        missed = true;
        all[t][k].fired = true;
      }
    }
  }
  await setAllReminders(all);
  if (missed) {
    browser.notifications.create("missedReminders", {
      type: "basic",
      iconUrl: "icon48.png",
      title: "[remindme]",
      message: "You missed some reminders while the browser was closed!"
    });
  }
});