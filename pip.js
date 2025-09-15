// pip.js — Complete PiP helper (drop-in replacement)
// This file runs in the page context. It must be injected *and then* the open function invoked
// immediately from the user's click (via chrome.scripting.executeScript) so the final requestPictureInPicture
// runs with user activation and avoids NotAllowedError.

(function () {
  if (window.__SC_PIP_installed_v2) {
    // Already installed
    return;
  }
  window.__SC_PIP_installed_v2 = true;

  // --- Config ---
  const CANVAS_W = 480;
  const CANVAS_H = 270;
  const REDRAW_FPS = 4;
  const POLL_INTERVAL_MS = 300;

  // --- State ---
  let canvas = null;
  let ctx = null;
  let video = null;
  let stream = null;
  let drawTimer = null;
  let pollTimer = null;
  let isPiPOpen = false;
  let pipWindowRef = null;
  let current = { title: '', artwork: null, isPlaying: false, href: null };
  let artworkImg = { url: null, img: null, loaded: false, errored: false };
  let playControlObserver = null;
  let mediaSessionSetup = false; // Flag to ensure Media Session is set up only once
  let stateDebounceTimer = null; // Debounce timer for state updates

  // --- Reset localStorage on page load ---
  localStorage.removeItem('sc_prev_track_href'); // Clear on refresh

  // Helper: safe logger
  function log(...args) { try { console.debug('[SC-PIP]', ...args); } catch (e) {} }

  // --- DOM utilities ---
  function ensureElements() {
    if (canvas && video) return; // Already created

    // Create canvas
    canvas = document.getElementById('__sc_pip_canvas_v2');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = '__sc_pip_canvas_v2';
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      canvas.style.display = 'none'; // Keep canvas hidden
      document.documentElement.appendChild(canvas);
    }
    ctx = canvas.getContext('2d');

    // Create a hidden video that plays the canvas stream
    video = document.getElementById('__sc_pip_video_v2');
    if (!video) {
      video = document.createElement('video');
      video.id = '__sc_pip_video_v2';
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true; // Important for autoplay
      video.style.display = 'none'; // Keep video hidden
      document.documentElement.appendChild(video);
    }

    // Create capture stream and attach to video if not already
    if (!stream && canvas) {
      try {
        stream = canvas.captureStream(REDRAW_FPS);
        if (video) {
          video.srcObject = stream;
        }
      } catch (err) {
        log('captureStream failed', err);
        stream = null;
      }
    } else if (stream && video && !video.srcObject) {
      try {
        video.srcObject = stream;
        log('video.srcObject set after stream creation');
      } catch (err) {
        log('Failed to set video.srcObject', err);
      }
    }

    // Add video PiP lifecycle listeners
    video.addEventListener('enterpictureinpicture', () => {
      log('[SC-PIP] video enterpictureinpicture event fired');
      isPiPOpen = true;
      startDrawLoop();
      observePlayControl();
      log('[SC-PIP] Calling setupMediaSession from enterpictureinpicture');
      setupMediaSession();
    });

    video.addEventListener('leavepictureinpicture', () => {
      log('[SC-PIP] video leavepictureinpicture event fired');
      isPiPOpen = false;
      stopDrawLoop();
      stopPlayControlObserver();
      pipWindowRef = null;
    });

    // --- PiP Click Handling ---
    if (!canvas.__sc_pip_click_bound) {
      canvas.__sc_pip_click_bound = true;

      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const third = CANVAS_W / 3;

        if (x < third) {
          // Left third → Previous
          console.log('[SC-PIP] Previous track');
          if (typeof window.__SC_PREV_TRACK === 'function') {
            const prevHref = localStorage.getItem('sc_prev_track_href');
            if (prevHref) {
              window.location.href = prevHref;
            } else {
              window.__SC_PREV_TRACK();
            }
          } else {
            log('[SC-PIP] __SC_PREV_TRACK not found, dispatching event');
            window.dispatchEvent(new CustomEvent('sc-content-prev-track'));
          }
        } else if (x > third * 2) {
          // Right third → Next
          console.log('[SC-PIP] Next track');
          if (typeof window.__SC_NEXT_TRACK === 'function') {
            const currentInfo = window.__SC_GET_TRACK_INFO ? window.__SC_GET_TRACK_INFO() : getTrackInfoFromDom();
            if (currentInfo.href) {
              localStorage.setItem('sc_prev_track_href', currentInfo.href);
            }
            window.__SC_NEXT_TRACK();
          } else {
             log('[SC-PIP] __SC_NEXT_TRACK not found, dispatching event');
             window.dispatchEvent(new CustomEvent('sc-content-next-track'));
          }
        } else {
          // Middle → Play/Pause
          console.log('[SC-PIP] Toggle play/pause');
          if (typeof window.__SC_TOGGLE_PLAY === 'function') {
            window.__SC_TOGGLE_PLAY();
          } else {
            log('[SC-PIP] __SC_TOGGLE_PLAY not found, dispatching event');
            window.dispatchEvent(new CustomEvent('sc-content-play-toggle'));
          }

          setTimeout(() => {
            try {
                const info = typeof window.__SC_GET_TRACK_INFO === 'function' ? window.__SC_GET_TRACK_INFO() : getTrackInfoFromDom();
                debouncedApplyTrackInfo(info);
              } catch (e) {
                log('Error refreshing state after toggle:', e);
              }
          }, 300);
        }
      });
    }
  }

  // --- Media Session API Integration ---
  function setupMediaSession() {
    if (mediaSessionSetup || !('mediaSession' in navigator)) {
        if (!mediaSessionSetup) log('[SC-PIP] Media Session API not available or already set up.');
        return;
    }

    log('[SC-PIP] Setting up Media Session API...');
    mediaSessionSetup = true;

    try {
        navigator.mediaSession.setActionHandler('play', () => {
            log('[SC-PIP] Media Session: Play action triggered.');
            if (typeof window.__SC_TOGGLE_PLAY === 'function') {
                window.__SC_TOGGLE_PLAY();
            } else {
                window.dispatchEvent(new CustomEvent('sc-content-play-toggle'));
            }
            if (video) {
                video.muted = true;
                video.play().catch(e => log('[SC-PIP] video.play() from MediaSession failed:', e));
            }
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            log('[SC-PIP] Media Session: Pause action triggered.');
            if (typeof window.__SC_TOGGLE_PLAY === 'function') {
                window.__SC_TOGGLE_PLAY();
            } else {
                window.dispatchEvent(new CustomEvent('sc-content-play-toggle'));
            }
            if (video) {
                video.pause();
            }
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            log('[SC-PIP] Media Session: Previous track action triggered.');
            if (typeof window.__SC_PREV_TRACK === 'function') {
                window.__SC_PREV_TRACK();
            } else {
                window.dispatchEvent(new CustomEvent('sc-content-prev-track'));
            }
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            log('[SC-PIP] Media Session: Next track action triggered.');
            if (typeof window.__SC_NEXT_TRACK === 'function') {
                window.__SC_NEXT_TRACK();
            } else {
                window.dispatchEvent(new CustomEvent('sc-content-next-track'));
            }
        });

        navigator.mediaSession.setActionHandler('stop', () => {
            log('[SC-PIP] Media Session: Stop action triggered.');
            if (typeof window.__SC_PIP_close === 'function') {
                 window.__SC_PIP_close();
            }
        });

        log('[SC-PIP] Media Session API action handlers registered.');
    } catch (e) {
        log('[SC-PIP] Failed to register Media Session action handlers:', e);
    }
  }

  // --- Drawing ---
  function clearCanvas() {
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // --- CORRECTED drawFrame function ---
  function drawFrame() {
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#0f0f10';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Artwork
    const margin = 12;
    const artSize = Math.min(200, CANVAS_H - margin * 2);
    const artX = margin;
    const artY = margin;

    if (artworkImg.loaded && artworkImg.img) {
      try {
        ctx.drawImage(artworkImg.img, artX, artY, artSize, artSize);
      } catch (e) {
        log('drawImage failed (CORS?)', e);
        drawArtPlaceholder(artX, artY, artSize);
      }
    } else {
      drawArtPlaceholder(artX, artY, artSize);
    }

    // Text area
    const textX = artX + artSize + 12;
    const textW = CANVAS_W - textX - margin;
    const title = current.title || document.title || 'Unknown track';
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
    wrapText(ctx, title, textX, artY + 6 + 18, textW, 20, 3);

    // Playing state
    ctx.font = '13px system-ui';
    ctx.fillStyle = '#cfcfcf';
    ctx.fillText(current.isPlaying ? 'Playing' : 'Paused', textX, artY + artSize - 8);

    // Play/Pause circular icon bottom-right
    const cx = CANVAS_W - 40;
    const cy = CANVAS_H - 40;
    const r = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.fillStyle = '#fff';

    if (current.isPlaying) {
      // pause symbol
      ctx.fillRect(cx - 7, cy - 9, 5, 18);
      ctx.fillRect(cx + 2, cy - 9, 5, 18);
    } else {
      // triangle play
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 10);
      ctx.lineTo(cx - 6, cy + 10);
      ctx.lineTo(cx + 10, cy);
      ctx.closePath();
      ctx.fill();
    }
    
    // --- CORRECTED LOGIC ---
    // Only attempt to play if the track is actually playing.
    if (current.isPlaying && video && typeof video.play === 'function' && isPiPOpen) {
      video.play().catch((e) => log('video.play() failed in drawFrame:', e));
    }
  }

  function drawArtPlaceholder(x, y, size) {
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#666';
    ctx.font = '12px system-ui';
    ctx.fillText('No artwork', x + 10, y + size / 2);
  }

  function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 4) {
    const words = text.split(' ');
    let line = '';
    let lines = 0;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = context.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        context.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
        lines++;
        if (lines >= maxLines) {
          context.fillText('…', x + maxWidth - 10, y);
          return;
        }
      } else {
        line = testLine;
      }
    }
    context.fillText(line, x, y);
  }

 // - Artwork loader -
  function loadArtwork(url) {
    if (!url) {
        artworkImg = { url: null, img: null, loaded: false, errored: false };
        drawFrame();
        return;
    }
    
    // Append a unique timestamp to the URL to bypass any caching issues
    const uniqueUrl = url + (url.includes('?') ? '&' : '?') + 'cacheBust=' + Date.now();
    
    if (artworkImg.url === uniqueUrl && artworkImg.loaded) return;

    artworkImg = { url: uniqueUrl, img: null, loaded: false, errored: false };
    const img = new Image();
    img.crossOrigin = "Anonymous";
    
    img.onload = () => {
        artworkImg.img = img;
        artworkImg.loaded = true;
        artworkImg.errored = false;
        log('[SC-PIP] Artwork loaded successfully:', uniqueUrl);
        drawFrame();
    };
    img.onerror = (e) => {
        log('[SC-PIP] Failed to load artwork:', uniqueUrl, e);
        artworkImg.errored = true;
        artworkImg.loaded = false;
        drawFrame();
    };
    
    img.src = uniqueUrl;
    log('[SC-PIP] Attempting to load artwork:', uniqueUrl);
  }

  // --- Draw loop ---
  function startDrawLoop() {
    if (drawTimer) return;
    drawFrame();
    drawTimer = setInterval(drawFrame, Math.round(1000 / REDRAW_FPS));
    log('[SC-PIP] Draw loop started');
  }

  function stopDrawLoop() {
    if (!drawTimer) return;
    clearInterval(drawTimer);
    drawTimer = null;
    log('[SC-PIP] Draw loop stopped');
  }

  // --- Debounced State Update ---
  function debouncedApplyTrackInfo(info) {
    if (!info) return;
    clearTimeout(stateDebounceTimer);
    stateDebounceTimer = setTimeout(() => {
      _applyTrackInfo(info);
    }, 100);
  }

  // --- Polling ---
  function pollTrackInfoLoop() {
    if (pollTimer) return;
    
    try {
        const info = typeof window.__SC_GET_TRACK_INFO === 'function' ? window.__SC_GET_TRACK_INFO() : getTrackInfoFromDom();
        debouncedApplyTrackInfo(info);
    } catch (e) {
        log('Error during initial pollTrackInfoLoop:', e);
    }

    pollTimer = setInterval(() => {
      try {
        const info = typeof window.__SC_GET_TRACK_INFO === 'function' ? window.__SC_GET_TRACK_INFO() : getTrackInfoFromDom();
        debouncedApplyTrackInfo(info);
      } catch (e) {
        log('Error during pollTrackInfoLoop interval:', e);
      }
    }, POLL_INTERVAL_MS);
    log('[SC-PIP] Polling loop started');
  }

  function stopPollTrackInfoLoop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      log('[SC-PIP] Polling loop stopped');
    }
  }

  // --- MutationObserver for play/pause ---
  function observePlayControl() {
    stopPlayControlObserver();
    const playPauseButton = document.querySelector('.playControls__play');

    if (!playPauseButton) {
        log('[SC-PIP] Play/Pause button not found for MutationObserver');
        return; // Exit if the element is not found
    }

    // Now it's safe to observe the button
    playControlObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          log(`[SC-PIP] Play button attribute 'class' changed. Refreshing state.`);
          const info = getTrackInfoFromDom();
          debouncedApplyTrackInfo(info);
        }
      });
    });

    playControlObserver.observe(playPauseButton, {
      attributes: true,
      attributeFilter: ['class']
    });
    log('[SC-PIP] Play control observer started');
  }

  function stopPlayControlObserver() {
    if (playControlObserver) {
      playControlObserver.disconnect();
      playControlObserver = null;
      log('[SC-PIP] Play control observer stopped');
    }
  }

  // --- Fallback DOM info ---
  function getTrackInfoFromDom() {
    try {
      const miniTitleEl = document.querySelector('.playbackSoundBadge__titleLink, .playbackSoundBadge__title a');
      const mainTitleEl = document.querySelector('.soundTitle__title');
      const titleEl = miniTitleEl || mainTitleEl;
      const title = (titleEl?.textContent.trim()) || document.title;

      let artwork = null;
      const artworkElement = document.querySelector('.playbackSoundBadge__artwork span, .playbackSoundBadge__artwork img, .sc-artwork-visualisation span, .sc-artwork-visualisation img');
      if (artworkElement) {
        let url = artworkElement.src || (artworkElement.style.backgroundImage || '').replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
        if (url) {
          artwork = url.replace('-t50x50.png', '-t500x500.png');
        }
      }
      
      const playPauseButton = document.querySelector('.playControls__play');
      let isPlaying = false;
      if (playPauseButton) {
        isPlaying = playPauseButton.classList.contains('playing');
      }
      const trackLink = document.querySelector('.playbackSoundBadge__titleLink, .playbackSoundBadge__title a');
      const href = trackLink?.href || null;

      return { title, artwork, isPlaying, href };
    } catch (e) {
      console.error('[SC-PIP] getTrackInfoFromDom error', e);
      return { title: null, artwork: null, isPlaying: false, href: null };
    }
  }


  // --- Apply track info ---
  function _applyTrackInfo(info) {
    if (!info) return;

    const titleChanged = info.title !== current.title;
    const isPlayingChanged = !!info.isPlaying !== !!current.isPlaying;
    
    if (info.artwork && info.artwork !== current.artwork) {
      current.artwork = info.artwork;
      log('[SC-PIP] Artwork URL changed:', current.artwork);
      loadArtwork(info.artwork);
    } else if (!info.artwork && current.artwork) {
        if (info.href !== current.href) {
            current.artwork = null;
            artworkImg = { url: null, img: null, loaded: false, errored: false };
            log('[SC-PIP] New track has no artwork, clearing.');
        }
    }
    
    current.href = info.href;

    let needsRedraw = false;

    if (titleChanged) {
        current.title = info.title;
        log('[SC-PIP] Title changed:', current.title);
        needsRedraw = true;
    }

    if (isPlayingChanged) {
        log(`[SC-PIP] Play state changed. Was: ${current.isPlaying}, Now: ${!!info.isPlaying}`);
        
        current.isPlaying = !!info.isPlaying;
        
        if (current.isPlaying) {
            video.play().catch(e => log('video.play() failed:', e));
        } else {
            video.pause();
        }
        needsRedraw = true;
    }

    if (needsRedraw) {
        log('[SC-PIP] Applying track info (redraw triggered):', info);
        drawFrame();
    } else {
        log('[SC-PIP] Applying track info (no redraw needed):', info);
    }
  }

  // --- Open / Close PiP ---
  async function openPiP() {
    try {
      if (isCurrentlyPiPOpen()) {
        log('[SC-PIP] PiP already open — skipping');
        return;
      }
      ensureElements();

      try {
        const info = typeof window.__SC_GET_TRACK_INFO === 'function' ? window.__SC_GET_TRACK_INFO() : getTrackInfoFromDom();
        log('[SC-PIP] Got track info from content script:', info);
        debouncedApplyTrackInfo(info);
      } catch (e) {
        log('[SC-PIP] Initial getTrackInfo failed', e);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      log('[SC-PIP] Using requestElementPiP...');
      await requestElementPiP(video);
      setupMediaSession();

      pollTrackInfoLoop();
      observePlayControl();

      if (current.isPlaying) {
        startDrawLoop();
      } else {
        stopDrawLoop();
        drawFrame();
      }

      log('[SC-PIP] PiP opened successfully');
    } catch (err) {
      log('[SC-PIP] openPiP error:', err);
      await closePiP().catch(() => {});
    }
  }

  async function requestElementPiP(videoEl) {
    if (!videoEl) throw new Error('[SC-PIP] video element missing for PiP request');
    if (!videoEl.requestPictureInPicture) {
      throw new Error('[SC-PIP] No requestPictureInPicture API available on video element');
    }
    log('[SC-PIP] Requesting Element PiP...');
    const pipWindow = await videoEl.requestPictureInPicture();
    isPiPOpen = true;
    pipWindowRef = pipWindow;
    log('[SC-PIP] Element PiP requested successfully');
    return pipWindow;
  }

  async function closePiP() {
    log('[SC-PIP] Closing PiP...');
    try {
      await document.exitPictureInPicture();
      log('[SC-PIP] exitPictureInPicture called');
    } catch (e) {
      log('[SC-PIP] exitPictureinPicture error (might not be open):', e);
    }
    try {
      if (pipWindowRef?.close) {
        pipWindowRef.close();
        log('[SC-PIP] pipWindowRef closed');
      }
    } catch (e) {
      log('[SC-PIP] Error closing pipWindowRef:', e);
    }

    stopDrawLoop();
    stopPollTrackInfoLoop();
    stopPlayControlObserver();

    isPiPOpen = false;
    pipWindowRef = null;
    log('[SC-PIP] PiP closed and resources cleaned up');
  }

  function isCurrentlyPiPOpen() {
    try {
      return document.pictureInPictureElement === video;
    } catch (e) {
      log('[SC-PIP] Error using document.pictureInPictureElement, falling back to flag:', e);
      return !!isPiPOpen;
    }
  }

  // --- Listen for sc-track-changed (from content script) ---
  window.addEventListener('sc-track-changed', (ev) => {
    const detail = ev?.detail;
    if (detail) {
        log('[SC-PIP] Received sc-track-changed:', detail);
        debouncedApplyTrackInfo(detail);
    } else {
       log('[SC-PIP] Received sc-track-changed event, but detail was missing');
    }
  });

  // --- Expose functions globally for the content script or popup to call ---
  window.__SC_PIP_open = async function () {
    if (isCurrentlyPiPOpen()) {
        log('[SC-PIP] __SC_PIP_open called, but PiP is already open');
        return;
    }
    log('[SC-PIP] __SC_PIP_open called');
    await openPiP();
  };

  window.__SC_PIP_close = async function () {
    log('[SC-PIP] __SC_PIP_close called');
    await closePiP();
  };

  // --- Initialization ---
  try {
    log('[SC-PIP] Initializing PiP helper...');
    ensureElements();

    const info = typeof window.__SC_GET_TRACK_INFO === 'function' ? window.__SC_GET_TRACK_INFO() : getTrackInfoFromDom();
    debouncedApplyTrackInfo(info);
    
    pollTrackInfoLoop();
    observePlayControl();

    log('[SC-PIP] Initialization complete');
  } catch (e) {
    log('[SC-PIP] Initialization error:', e);
  }

  // --- Debug ---
  window.__SC_PIP_status = function () {
    return {
      isPiPOpen: isCurrentlyPiPOpen(),
      current,
      artworkUrl: artworkImg.url,
      artworkLoaded: artworkImg.loaded,
      artworkErrored: artworkImg.errored,
      pipWindowRefExists: !!pipWindowRef,
      drawTimerActive: !!drawTimer,
      pollTimerActive: !!pollTimer,
      playControlObserverActive: !!playControlObserver,
      mediaSessionSetup: mediaSessionSetup
    };
  };

  // --- Cleanup on page unload ---
  window.addEventListener('beforeunload', () => {
    log('[SC-PIP] Page unloading, closing PiP...');
    closePiP();
  });

  // --- Optional: Listen for custom events if content script functions aren't injected ---
  window.addEventListener('sc-content-play-toggle', () => {
     log('[SC-PIP] Received sc-content-play-toggle event (fallback)');
     const playPauseButton = document.querySelector('.playControls .playButton, .sc-button-play.playButton, .sc-button-pause.playButton');
     if (playPauseButton) {
         playPauseButton.click();
         setTimeout(() => {
             const info = getTrackInfoFromDom();
             debouncedApplyTrackInfo(info);
         }, 300);
     }
  });

  window.addEventListener('sc-content-next-track', () => {
     log('[SC-PIP] Received sc-content-next-track event (fallback)');
     const nextBtn = document.querySelector('.playControls .skipControl__next, .skipControl__next, .skipControlNext');
     if (nextBtn) nextBtn.click();
  });

  window.addEventListener('sc-content-prev-track', () => {
     log('[SC-PIP] Received previous track request via CustomEvent (fallback)');
     const prevBtn = document.querySelector('.playControls .skipControl__previous, .skipControl__previous, .skipControlPrev');
     if (prevBtn) prevBtn.click();
  });

})();