// content.js – SoundCloud PiP Helper (Fixed for Mini Player)
// Focus on mini player elements instead of main page content

(function () {
  if (window.__SC_CONTENT_INITIALIZED) return;
  window.__SC_CONTENT_INITIALIZED = true;

  // --- State ---
  let last = null;
  let debounceTimer = null;

// --- Get current track info from MINI PLAYER ---
  function getTrackInfo() {
    // --- Focus on mini player elements first ---

    // Title - prioritize mini player title
    const miniTitle = document.querySelector(
      '.playbackSoundBadge__titleLink, ' +
      '.playbackSoundBadge__title a, ' +
      '.playbackSoundBadge__title'
    );

    // Fallback to main page title if mini player not found
    const mainTitle = document.querySelector('.soundTitle__title');
    const titleEl = miniTitle || mainTitle;
    const title = titleEl?.textContent.trim() || document.title;

    // --- Track link from mini player ---
    const trackLink = document.querySelector('.playbackSoundBadge__titleLink, .playbackSoundBadge__title a');
    const href = trackLink?.href || null;

    // --- Artwork - prioritize mini player avatar ---
    let artwork = null;
    let artSpan = null;
    // First try mini player avatar span (background-image)
    const miniAvatarSpan = document.querySelector('.playbackSoundBadge .image__full');
    if (miniAvatarSpan) {
      const style = miniAvatarSpan.getAttribute('style');
      if (style) {
        const match = style.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/i);
        if (match && match[1]) {
          // --- Corrected Artwork URL Replacement ---
          artwork = match[1].replace(/-t50x50(\.(png|jpg))?$/i, '-t500x500$1');
          // --- End Correction ---
          console.log('[SC-CONTENT] Artwork found in mini player:', artwork);
        } else {
          console.log('[SC-CONTENT] No artwork URL found in mini player style attribute');
        }
      } else {
        console.log('[SC-CONTENT] No style attribute found on mini player artwork span');
      }
    } else {
      console.log('[SC-CONTENT] No mini player artwork span found');
    }

    // Fallback to main player artwork if mini player doesn't have it
    if (!artwork) {
      const artSpan = document.querySelector('.listenArtworkWrapper__artwork .image__full');
      if (artSpan) {
        const style = artSpan.getAttribute('style');
        if (style) {
          const match = style.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/i);
          if (match && match[1]) {
            // --- Corrected Artwork URL Replacement (Fallback) ---
            artwork = match[1].replace(/-t50x50(\.(png|jpg))?$/i, '-t500x500$1');
            // --- End Correction ---
            console.log('[SC-CONTENT] Artwork found in main player:', artwork);
          } else {
            console.log('[SC-CONTENT] No artwork URL found in main player style attribute');
          }
        } else {
          console.log('[SC-CONTENT] No style attribute found on main player artwork span');
        }
      } else {
        console.log('[SC-CONTENT] No main player artwork span found');
      }
    }

    // Final fallback to any artwork image
    if (!artwork) {
      const artImg = document.querySelector('.sc-artwork img');
      if (artImg && artImg.src) {
        // --- Corrected Artwork URL Replacement (Final Fallback) ---
        artwork = artImg.src.replace(/-t50x50(\.(png|jpg))?$/i, '-t500x500$1');
        // --- End Correction ---
        console.log('[SC-CONTENT] Artwork found via fallback:', artwork);
      } else {
        console.log('[SC-CONTENT] No artwork found via fallback');
      }
    }

    // --- Play state - use the mini player controls ---
    // --- Improved Play State Detection ---
    let isPlaying = false;

    // Check for elements indicating the player IS PLAYING using more flexible selectors
    // These selectors are based on common patterns in the provided HTML and previous analysis
    const isPlayingIndicated =
      !!document.querySelector('button[aria-label*="Pause"i]') || // Look for 'Pause' in aria-label (case-insensitive)
      !!document.querySelector('button[title*="Pause"i]') ||     // Look for 'Pause' in title (case-insensitive)
      !!document.querySelector('.playControls .sc-button-pause') || // Look for standard pause button class
      !!document.querySelector('.playControls .playControls__play.playing'); // Specific check for 'playing' class

    isPlaying = !!isPlayingIndicated; // Convert to boolean
    console.log(`[SC-CONTENT] Play state detected: ${isPlaying}`);
    // --- End Improvement ---

    // --- Return info with debug data ---
    console.log('[SC-CONTENT] Sending track info:', { title, artwork, isPlaying, href });
    return {
      title,
      artwork,
      isPlaying,
      href,
      // Debug info to help troubleshoot
      _debug: {
        titleSource: miniTitle ? 'mini' : 'main',
        artworkSource: miniAvatarSpan ? 'mini_span' : (artSpan ? 'main_span' : (artImg ? 'fallback_img' : 'none')),
        isPlayingIndicatedBy: {
          ariaLabelPause: !!document.querySelector('button[aria-label*="Pause"i]'),
          titlePause: !!document.querySelector('button[title*="Pause"i]'),
          scButtonPause: !!document.querySelector('.playControls .sc-button-pause'),
          playingClass: !!document.querySelector('.playControls .playControls__play.playing')
        }
      }
    };
  }

  // --- Control functions - focus on mini player controls ---
  function nextTrack() {
    const nextBtn = document.querySelector('.playControls .skipControl__next, ' +
        '.playControls .skipControl_next, ' +
        '.skipControl__next, ' +
        '.skipControlNext');
    
    if (nextBtn) {
        console.log('[SC-CONTENT] Next track clicked');
        nextBtn.click();
        
        setTimeout(() => {
            const info = getTrackInfo();
            console.log('[SC-CONTENT] Next track info:', info);
            window.dispatchEvent(new CustomEvent('sc-track-changed', { detail: info }));
        }, 800);
    } else {
        console.warn('[SC-CONTENT] Next button not found');
    }
  }

  function prevTrack() {
    // Look for previous button in mini player first
    const prevBtn = document.querySelector(
      '.playControls .skipControl__previous, ' +
      '.playControls .skipControl_prev, ' +
      '.skipControl__previous, ' +
      '.skipControlPrev'
    );

    if (prevBtn) {
      console.log('[SC-CONTENT] Previous track clicked');
      prevBtn.click();
      // Wait longer for track change to register
      setTimeout(() => {
        const info = getTrackInfo();
        console.log('[SC-CONTENT] Previous track info:', info);
        window.dispatchEvent(new CustomEvent('sc-track-changed', { detail: info }));
      }, 800); // Increased delay
    } else {
      console.warn('[SC-CONTENT] Previous button not found');
    }
  }

  // Toggle play/pause - focus on mini player
  window.__SC_TOGGLE_PLAY = () => {
    // Use the same selector as in getTrackInfo()
    const playPauseButton = document.querySelector('.playControls__play');
    
    if (!playPauseButton) {
      console.warn("No play/pause button found (.playControls__play)");
      return;
    }

    console.log('[SC-CONTENT] Toggle play/pause clicked');
    playPauseButton.click();

    // Wait for DOM to stabilize and emit change
    setTimeout(() => {
      const info = getTrackInfo();
      console.log("[SC-CONTENT] Emitting track-changed after toggle:", info);
      window.dispatchEvent(new CustomEvent('sc-track-changed', { detail: info }));
    }, 500);
  };

  // Expose functions globally
  window.__SC_NEXT_TRACK = nextTrack;
  window.__SC_PREV_TRACK = prevTrack;
  window.__SC_GET_TRACK_INFO = getTrackInfo;

  // ---Enhanced Mutation Observer - watch BOTTOM mini player specifically---
  let mo = null;

  const initObservers = () => {
    const bottomMiniPlayer = document.querySelector('.playbackSoundBadge, .playControls');

    if (bottomMiniPlayer) {
        mo = new MutationObserver((mutations) => {
            const isRelevantMutation = mutations.some(mutation => {
                if (mutation.type === 'characterData') return true;
                
                if (mutation.type === 'attributes') {
                    return ['src', 'class', 'title', 'aria-pressed', 'aria-label', 'style'].includes(mutation.attributeName);
                }
                
                if (mutation.type === 'childList') {
                    const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
                    return nodes.some(node => {
                        if (node.nodeType === 1) {
                            return node.classList?.contains('playbackSoundBadge__title') ||
                                   node.classList?.contains('sc-artwork') ||
                                   node.classList?.contains('playButton') ||
                                   node.querySelector?.('.playbackSoundBadge__title, .sc-artwork, .playButton') ||
                                   node.getAttribute?.('style')?.includes('background-image');
                        }
                        return false;
                    });
                }
                return false;
            });
            
            if (isRelevantMutation) {
                if (debounceTimer) clearTimeout(debounceTimer);
                
                debounceTimer = setTimeout(() => {
                    const info = getTrackInfo();
                    const now = JSON.stringify({ title: info.title, artwork: info.artwork, isPlaying: info.isPlaying });
                    
                    if (now !== last) {
                        last = now;
                        console.log('[SC-CONTENT] Mini player state changed:', {
                            title: info.title,
                            hasArtwork: !!info.artwork,
                            isPlaying: info.isPlaying
                        });
                        window.dispatchEvent(new CustomEvent('sc-track-changed', { detail: info }));
                    }
                }, 200);
            }
        });

        mo.observe(bottomMiniPlayer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'class', 'title', 'aria-pressed', 'aria-label', 'style'],
            characterData: true
        });
    }
  };

  // Setup observers on page load
  window.addEventListener('load', () => {
    initObservers();
  });

  // --- Initial event with delay ---
  setTimeout(() => {
    const info = getTrackInfo();
    console.log('[SC-CONTENT] Initial track info:', info);
    window.dispatchEvent(new CustomEvent('sc-track-changed', { detail: info }));
  }, 1200);
// Expose public API
window.scContentApi = {
  getTrackInfo: getTrackInfo
};
})();