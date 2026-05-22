// manifest.json
{
  "manifest_version": 3,
  "name": "Playlist Detector",
  "version": "1.0",
  "description": "Detects .m3u8 and .mpd playlist URLs from network requests",
  "permissions": [
    "webRequest",
    "storage",
    "tabs"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "bg.js"
  },
  "action": {
    "default_popup": "popup.html"
  }
}

// bg.js
const seen = new Set();

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const url = details.url;

    if (url.includes('.m3u8') || url.includes('.mpd')) {
      if (seen.has(url)) return;
      seen.add(url);

      chrome.tabs.get(details.tabId, (tab) => {
        const entry = {
          url,
          title: tab?.title || 'Unknown',
          tabId: details.tabId,
          time: Date.now()
        };

        chrome.storage.local.get({ playlists: [] }, (data) => {
          const updated = [entry, ...data.playlists];
          chrome.storage.local.set({ playlists: updated });
        });
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// popup.html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 10px; width: 300px; }
    .item { margin-bottom: 10px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
    button { margin-top: 5px; }
  </style>
</head>
<body>
  <h3>Detected Playlists</h3>
  <div id="list"></div>
  <script src="popup.js"></script>
</body>
</html>

// popup.js
function copy(text) {
  navigator.clipboard.writeText(text);
}

function render(playlists) {
  const list = document.getElementById('list');
  list.innerHTML = '';

  playlists.forEach(p => {
    const div = document.createElement('div');
    div.className = 'item';

    const title = document.createElement('div');
    title.textContent = p.title;

    const url = document.createElement('div');
    url.textContent = p.url;
    url.style.wordBreak = 'break-all';

    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    btn.onclick = () => copy(p.url);

    div.appendChild(title);
    div.appendChild(url);
    div.appendChild(btn);

    list.appendChild(div);
  });
}

chrome.storage.local.get({ playlists: [] }, (data) => {
  render(data.playlists);
});

// Optional: clear duplicates button
// Add this inside popup.html if needed:
// <button id="clear">Clear</button>

// And in popup.js:
// document.getElementById('clear').onclick = () => {
//   chrome.storage.local.set({ playlists: [] }, () => render([]));
// };

// content.js (optional, not strictly needed here)
// Can be used if you want to inject UI into the page later
console.log('Content script loaded');
