/**
 * Window management for DragonOS
 * - Single, clean stacking logic using a global z-index counter
 * - Windows go to front on open, click, and drag
 * - Draggable windows convert CSS transform-centering to absolute top/left only during drag
 * - Safe, idempotent wiring (won't double-bind if called more than once)
 */

(function () {
  // Utility helpers
  var $ = function (sel) {
    return document.querySelector(sel);
  };
  var $$ = function (sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  };

  // Clock: update once per second if #timeElement exists
  (function setupClock() {
    var timeElem = $("#timeElement");
    if (!timeElem) return;
    setInterval(function () {
      timeElem.textContent = new Date().toLocaleString();
    }, 1000);
  })();

  // Stacking: single global z-index counter shared across all scripts
  // Start at 10 to leave room for other UI elements
  if (typeof window._zCounter !== "number") {
    window._zCounter = 10;
  }

  function bringToFront(el) {
    if (!el) return;
    window._zCounter += 1;
    el.style.zIndex = String(window._zCounter);
  }

  function isVisible(el) {
    if (!el) return false;
    var s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  // Initialize stacking order for any already-visible windows
  (function initializeStacking() {
    $$(".intro-div").forEach(function (win) {
      if (isVisible(win)) {
        bringToFront(win);
      }
    });
  })();

  // Make a window draggable by its header if present, otherwise by the entire element
  function makeDraggable(winEl) {
    if (!winEl || winEl.dataset.draggableWired === "true") return;

    var header = document.getElementById(winEl.id + "header");
    var dragHandle = header || winEl;

    var startX = 0,
      startY = 0,
      initialMouseX = 0,
      initialMouseY = 0;

    function onMouseDown(e) {
      // Only react to primary button
      if (e.button !== 0) return;
      e.preventDefault();
      bringToFront(winEl);

      // If the element uses transform-based centering via CSS, convert its current
      // rendered position to explicit absolute top/left so we can drag from there.
      var hasInlineTop = !!winEl.style.top;
      var hasInlineLeft = !!winEl.style.left;
      if (!hasInlineTop && !hasInlineLeft) {
        var rect = winEl.getBoundingClientRect();
        var docTop = rect.top + window.scrollY;
        var docLeft = rect.left + window.scrollX;
        winEl.style.position = "absolute";
        winEl.style.top = docTop + "px";
        winEl.style.left = docLeft + "px";
        winEl.style.transform = "none";
      }

      startX = winEl.offsetLeft;
      startY = winEl.offsetTop;
      initialMouseX = e.clientX;
      initialMouseY = e.clientY;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e) {
      e.preventDefault();
      var dx = e.clientX - initialMouseX;
      var dy = e.clientY - initialMouseY;
      winEl.style.left = startX + dx + "px";
      winEl.style.top = startY + dy + "px";
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    dragHandle.addEventListener("mousedown", onMouseDown);
    winEl.dataset.draggableWired = "true";
  }

  // Open/close helpers
  function openWindow(winEl) {
    if (!winEl) return;

    // If minimized, clear the minimized state so CSS/display can show it again
    winEl.classList.remove("window-minimized");

    // Window should go to front immediately on open
    bringToFront(winEl);

    // Remove inline display so the stylesheet governs layout (avoid forcing flex/block)
    winEl.style.removeProperty("display");

    // Clear any inline positioning so CSS centering (top/left 50% with transform) is used again
    // Use RAF to avoid layout thrash on the same frame
    requestAnimationFrame(function () {
      winEl.style.removeProperty("top");
      winEl.style.removeProperty("left");
      winEl.style.removeProperty("right");
      winEl.style.removeProperty("bottom");
      winEl.style.removeProperty("position");
      winEl.style.removeProperty("transform");

      // If this is the blog, focus the content area to enable keyboard scrolling
      if (winEl.id === "blog") {
        var content = document.getElementById("blogContent");
        if (content && typeof content.focus === "function") {
          content.focus();
        }
      }
    });
  }

  function closeWindow(winEl) {
    if (!winEl) return;
    winEl.style.display = "none";
  }

  // Attach basic window behaviors to any element with .intro-div class
  function wireWindow(winEl) {
    if (!winEl || winEl.dataset.windowWired === "true") return;

    // Bring to front on any click/mousedown in the window
    // Use mousedown so it occurs before drag and before focus changes
    winEl.addEventListener("mousedown", function () {
      bringToFront(winEl);
    });

    // Enable dragging by header or whole window
    makeDraggable(winEl);

    winEl.dataset.windowWired = "true";
  }

  // Wire close/open controls by id convention:
  // - window element id: <name> (e.g., 'welcome', 'blog')
  // - open trigger id: <name>open
  // - close button id: <name>close
  function wireOpenClose(name) {
    var winEl = $("#" + name);
    if (!winEl) return;

    wireWindow(winEl);

    var openEl = $("#" + name + "open");
    var closeEl = $("#" + name + "close");

    if (openEl && openEl.dataset.openWired !== "true") {
      openEl.addEventListener("click", function () {
        openWindow(winEl);
      });
      openEl.dataset.openWired = "true";
    }

    if (closeEl && closeEl.dataset.closeWired !== "true") {
      closeEl.addEventListener("click", function () {
        closeWindow(winEl);
      });
      closeEl.dataset.closeWired = "true";
    }
  }

  // Wire all windows present on the page
  $$(".intro-div").forEach(wireWindow);

  // Wire known windows by naming convention
  ["welcome", "blog"].forEach(wireOpenClose);

  // Observe fullscreen toggles and adjust window bounds below the menu bar
  initFullscreenObserver();

  // Improve blog scroll handling so wheel scroll targets the content pane
  initBlogScrollCapture();

  // Adjust fullscreen bounds below the top bar and restore on exit
  function initFullscreenObserver() {
    var wins = Array.prototype.slice.call(document.querySelectorAll(".intro-div"));
    var topBar = document.querySelector(".top-bar");

    function adjustFullscreen(win, on) {
      if (on) {
        // Save previous inline geometry to restore on exit
        if (!win.dataset.prevGeomSaved) {
          win.dataset.prevTop = win.style.top || "";
          win.dataset.prevLeft = win.style.left || "";
          win.dataset.prevRight = win.style.right || "";
          win.dataset.prevBottom = win.style.bottom || "";
          win.dataset.prevPos = win.style.position || "";
          win.dataset.prevTransform = win.style.transform || "";
          win.dataset.prevWidth = win.style.width || "";
          win.dataset.prevHeight = win.style.height || "";
          win.dataset.prevGeomSaved = "1";
        }
        // Use CSS variables for fullscreen offsets; prefer app-specific if available
        var root = window.getComputedStyle(document.documentElement);
        var isBlog = win.id === "blog";
        var isTutorial = win.id === "tutorial";
        var topOffsetVar = isBlog
          ? (root.getPropertyValue('--blog-window-top-offset').trim() || root.getPropertyValue('--window-top-offset').trim() || '100px')
          : isTutorial
            ? (root.getPropertyValue('--tutorial-window-top-offset').trim() || root.getPropertyValue('--window-top-offset').trim() || '100px')
            : (root.getPropertyValue('--window-top-offset').trim() || '100px');
        var sideMarginVar = isBlog
          ? (root.getPropertyValue('--blog-window-side-margin').trim() || root.getPropertyValue('--window-side-margin').trim() || '16px')
          : isTutorial
            ? (root.getPropertyValue('--tutorial-window-side-margin').trim() || root.getPropertyValue('--window-side-margin').trim() || '16px')
            : (root.getPropertyValue('--window-side-margin').trim() || '16px');
        var bottomMarginVar = isBlog
          ? (root.getPropertyValue('--blog-window-bottom-margin').trim() || root.getPropertyValue('--window-bottom-margin').trim() || '16px')
          : isTutorial
            ? (root.getPropertyValue('--tutorial-window-bottom-margin').trim() || root.getPropertyValue('--window-bottom-margin').trim() || '16px')
            : (root.getPropertyValue('--window-bottom-margin').trim() || '16px');
        win.style.position = "fixed";
        win.style.top = topOffsetVar;
        win.style.left = sideMarginVar;
        // Set explicit size so the window is resizable in fullscreen
        (function() {
          var topPx = parseFloat(topOffsetVar);
          var sidePx = parseFloat(sideMarginVar);
          var bottomPx = parseFloat(bottomMarginVar);
          if (isNaN(topPx)) topPx = 0;
          if (isNaN(sidePx)) sidePx = 0;
          if (isNaN(bottomPx)) bottomPx = 0;
          var vw = window.innerWidth || document.documentElement.clientWidth || 0;
          var vh = window.innerHeight || document.documentElement.clientHeight || 0;
          var initW = Math.max(260, vw - (sidePx * 2));
          var initH = Math.max(160, vh - (topPx + bottomPx));
          win.style.width = initW + "px";
          win.style.height = initH + "px";
        })();
        win.style.transform = "none";
        bringToFront(win);
      } else {
        // Restore previous inline geometry on exit
        if (win.dataset.prevGeomSaved) {
          win.style.top = win.dataset.prevTop || "";
          win.style.left = win.dataset.prevLeft || "";
          win.style.right = win.dataset.prevRight || "";
          win.style.bottom = win.dataset.prevBottom || "";
          win.style.position = win.dataset.prevPos || "";
          win.style.transform = win.dataset.prevTransform || "";
          win.style.width = win.dataset.prevWidth || "";
          win.style.height = win.dataset.prevHeight || "";
          delete win.dataset.prevGeomSaved;
          delete win.dataset.prevTop;
          delete win.dataset.prevLeft;
          delete win.dataset.prevRight;
          delete win.dataset.prevBottom;
          delete win.dataset.prevPos;
          delete win.dataset.prevTransform;
          delete win.dataset.prevWidth;
          delete win.dataset.prevHeight;
        }
      }
    }

    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === "attributes" && m.attributeName === "class") {
          var el = m.target;
          var on = el.classList.contains("window-fullscreen");
          adjustFullscreen(el, on);
        }
      });
    });

    wins.forEach(function (w) {
      obs.observe(w, { attributes: true, attributeFilter: ["class"] });
      // If already fullscreen, ensure it's adjusted
      if (w.classList.contains("window-fullscreen")) {
        adjustFullscreen(w, true);
      }
    });
  }

  // Route wheel scrolling inside the blog window to the content area
  function initBlogScrollCapture() {
    var blogWin = document.getElementById("blog");
    var blogContent = document.getElementById("blogContent");
    var blogList = document.getElementById("blogList");
    if (!blogWin) return;

    // If wheel happens anywhere on the blog window, scroll the content pane
    blogWin.addEventListener("wheel", function (e) {
      if (!blogContent) return;
      // Only handle if the event target isn't already a scrollable area consuming it
      var target = e.target;
      var withinContent = blogContent.contains(target);
      var withinList = blogList && blogList.contains(target);
      if (!withinContent && !withinList) {
        e.preventDefault();
        e.stopPropagation();
        blogContent.scrollTop += e.deltaY;
      }
    }, { passive: false });

    // Keep wheel events inside scrollable panes
    [blogContent, blogList].forEach(function (el) {
      if (!el) return;
      el.addEventListener("wheel", function (e) {
        // prevent bubbling to window/page
        e.stopPropagation();
      }, { passive: true });
    });
  }
})();