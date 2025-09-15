# github-PIP-extension
Our Development Journey: A Story of Debugging and Ingenuity
Building this extension was a journey of solving several unique challenges posed by SoundCloud's dynamic interface. We believe sharing these insights can help others on their own development paths.

1. Figuring Out High-Resolution Artwork
Initially, the artwork in the Picture-in-Picture window was tiny, a pixelated 50x50. A simple inspection revealed that the artwork URL contained the image resolution right in the path, like this: i1.sndcdn.com/artworks-xyz-t50x50.jpg.

The ingenuity was in realizing we could simply change that value! By replacing -t50x50 with -t500x500, we could fetch a much larger, higher-quality image. We then built a robust replacement function to handle both .png and .jpg file extensions to ensure it worked for every track.

JavaScript

// A simple yet powerful change to get a much better image
artwork = url.replace(/-t50x50(\.(png|jpg))?$/i, '-t500x500$1');

2. From Static Page to the Mini-Player
Our first approach was to grab track information from the main page's title and artwork elements. This worked, but it was brittle. When you navigate to a new page, the main elements would disappear before the new ones loaded, leading to blank screens in the PiP window.

The solution was to pivot to the mini-player at the bottom of the page. This element is persistent across the entire site. By fetching the title, artwork, and play state from this single, stable source, we created a much more reliable and smooth experience for the user.

JavaScript

// The final, more robust selector
const miniTitle = document.querySelector(
  '.playbackSoundBadge__titleLink, ' +
  '.playbackSoundBadge__title a, ' +
  '.playbackSoundBadge__title'
);

3. Tackling the isPlaying State
Detecting whether a track was playing or paused was a constant challenge. The button's class and attributes would change unpredictably, causing the PiP window to get stuck in the wrong state. We couldn't rely on a single attribute.

The ingenuity was in combining multiple checks to create a bulletproof state detection system. We implemented a MutationObserver that watches the play/pause button for any change in its class, aria-label, or title. If any of these attributes change, we then run a check against all possible states to determine if the track is playing.

JavaScript

let isPlaying = false;

const isPlayingIndicated =
  !!document.querySelector('button[aria-label*="Pause"i]') ||
  !!document.querySelector('button[title*="Pause"i]') ||
  !!document.querySelector('.playControls .sc-button-pause') ||
  !!document.querySelector('.playControls .playControls__play.playing');

isPlaying = !!isPlayingIndicated;

4. Handling Intermittent Image Loading (CORS & Caching)
Even with the correct artwork URL, we found that images would sometimes fail to load with an ERR_HTTP2_PROTOCOL_ERROR. This was a subtle and difficult bug to track down, as the URL was valid and it would work on a refresh.

The ingenuity here was in identifying this as a caching and CORS issue. We solved it in two ways:

We made sure the img.crossOrigin = "Anonymous"; attribute was set before setting the image source, allowing cross-origin requests.

We implemented a cache-busting technique by adding a unique timestamp to the end of every artwork URL. This forces the browser to make a fresh network request every time, bypassing any corrupted or stale cache.

JavaScript

// The fix for intermittent loading
const uniqueUrl = url + (url.includes('?') ? '&' : '?') + 'cacheBust=' + Date.now();
img.src = uniqueUrl;

5. User Activation for Picture-in-Picture
A common issue with browser extensions is that the requestPictureInPicture() API requires a direct user interaction. If the call isn't made synchronously from a user's click, the browser will throw a NotAllowedError.

Our solution was to architect the extension using chrome.scripting.executeScript. The first call injects our pip.js file into the page. The second call, executed immediately after, calls a function inside the now-injected pip.js file. Because this call chain is direct and triggered by a user's click on the popup button, it successfully satisfies the user activation requirement. This was a crucial part of making the entire extension work reliably.

A Final Note: A Learning Path with AI
I want to be upfront: I'm not a professional developer. This project was a personal learning experience, and it wouldn't have been possible without the help of modern AI tools. I've developed this entire extension using AI tools such as Qwen, Gemini, and Google AI Studio, which helped me debug, write code, and understand complex concepts along the way.

We believe in making the internet a more seamless and enjoyable place. This extension is a testament to the power of a few workarounds. While we've done our best to make it robust, the complexities of web development mean that things can break over time.

Until then, enjoy the extension, and we hope it makes your listening experience better!
