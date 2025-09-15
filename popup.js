// The popup's click handler will immediately inject and run the PiP creation code inside the active SoundCloud tab.
// This direct executeScript call occurs synchronously from the user's click, which satisfies the "user activation"
// requirement for requestPictureInPicture / requestWindow in the page context.


const openBtn = document.getElementById('open-pip');
const closeBtn = document.getElementById('close-pip');
const statusDiv = document.getElementById('status');


openBtn.addEventListener('click', async () => {
statusDiv.textContent = 'Status: trying to open PiP...';
try {
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (!tab || !tab.url.includes('soundcloud.com')) {
statusDiv.textContent = 'Status: open a SoundCloud track page first.';
return;
}


// Inject pip.js into the page (so its code executes in page context) and then call the open function.
await chrome.scripting.executeScript({
target: { tabId: tab.id },
files: ['pip.js']
});


// Now call the function defined by pip.js directly in the page context. Because this executeScript
// call is triggered synchronously by the user's click, the function body will have user activation.
await chrome.scripting.executeScript({
target: { tabId: tab.id },
func: () => {
// pipOpen is defined in pip.js
if (typeof window.__SC_PIP_open === 'function') {
window.__SC_PIP_open();
} else {
console.warn('pip helper not available');
}
}
});


statusDiv.textContent = 'Status: PiP open command sent.';
} catch (err) {
console.error(err);
statusDiv.textContent = 'Status: error - ' + (err && err.message ? err.message : err);
}
});


closeBtn.addEventListener('click', async () => {
statusDiv.textContent = 'Status: trying to close PiP...';
try {
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (!tab) return;
await chrome.scripting.executeScript({
target: { tabId: tab.id },
func: () => {
if (window.__SC_PIP_close) window.__SC_PIP_close();
}
});
statusDiv.textContent = 'Status: close command sent.';
} catch (err) {
console.error(err);
statusDiv.textContent = 'Status: error - ' + (err && err.message ? err.message : err);
}
});