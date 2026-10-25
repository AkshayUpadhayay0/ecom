/* Video: poster first, lazy, only visible clips play, a limited number at once.
 *   desktop: MAX_CONCURRENT_VIDEOS = 4        phone: MAX_CONCURRENT_VIDEOS_PHONE = 2
 *   hero + band share ONE slot (they are never on screen together).
 * Reduced motion, Save-Data and slow connections: posters only, tap to play.
 * (?savedata=1 in the address forces the constrained mode, for demonstrations and tests.) */
(function () {
  'use strict';

  var MAX_CONCURRENT_VIDEOS = 4;
  var MAX_CONCURRENT_VIDEOS_PHONE = 2;
  var HERO_SLOTS = 1;
  var VISIBLE_THRESHOLD = 0.35;
  var ROOT_MARGIN = '200px 0px';

  var mqPhone = window.matchMedia('(max-width: 767px)');
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var items = [];
  var io = null;

  function saveData() {
    var c = navigator.connection;
    return Boolean(c && (c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || '')));
  }
  function constrained() {
    return mqReduce.matches || saveData() || /[?&]savedata=1/.test(location.search);
  }
  function limit() {
    return mqPhone.matches ? MAX_CONCURRENT_VIDEOS_PHONE : MAX_CONCURRENT_VIDEOS;
  }

  var PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  function makeVideo(src) {
    var v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.src = src;
    return v;
  }

  function sourceFor(item) {
    var d = item.el.dataset;
    if (d.srcTall && mqPhone.matches) return d.srcTall;
    return d.video;
  }

  /* ---- plain loop ---- */
  function startPlain(item) {
    var v = makeVideo(sourceFor(item));
    item.video = v;
    item.el.appendChild(v);
    var p = v.play();
    if (p && p.then) {
      p.then(function () { item.el.classList.add('playing'); }, function () { stop(item); });
    }
  }

  /* ---- runway loop: two copies of the clip cross-fade just before the end, so the loop has no
   * jump; the layer drifts in slowly (CSS). REEL NOTES HOOK: pace, framing and overlay text from
   * the client's screen recording are applied through window.PROTO_HERO (home.js), nothing is
   * guessed here. ---- */
  function startRunway(item) {
    var cfg = window.PROTO_HERO || {};
    var fade = (cfg.crossfadeMs || 700) / 1000;
    var layer = item.el.querySelector('.layer');
    var src = sourceFor(item);
    var a = makeVideo(src);
    var b = makeVideo(src);
    if (cfg.playbackRate) { a.playbackRate = cfg.playbackRate; b.playbackRate = cfg.playbackRate; }
    layer.appendChild(a);
    layer.appendChild(b);
    item.video = a;
    item.extra = b;
    var current = a;
    var next = b;
    var switching = false;
    item.running = true;
    a.play().then(function () {
      a.classList.add('on');
      item.el.classList.add('playing');
    }, function () { stop(item); });

    function tick() {
      if (!item.running) return;
      var d = current.duration;
      if (d && !switching && current.currentTime >= d - fade - 0.05) {
        switching = true;
        next.currentTime = 0;
        next.play();
        next.classList.add('on');
        current.classList.remove('on');
        var old = current;
        window.setTimeout(function () {
          old.pause();
          old.currentTime = 0;
          current = next;
          next = old;
          switching = false;
        }, fade * 1000 + 60);
      }
      item.raf = window.requestAnimationFrame(tick);
    }
    item.raf = window.requestAnimationFrame(tick);
  }

  function start(item) {
    if (item.playing) return;
    item.playing = true;
    if (item.el.dataset.runway) startRunway(item);
    else startPlain(item);
    syncButton(item);
  }

  function stop(item) {
    if (!item.playing) return;
    item.playing = false;
    item.running = false;
    if (item.raf) window.cancelAnimationFrame(item.raf);
    [item.video, item.extra].forEach(function (v) {
      if (!v) return;
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
    });
    item.video = null;
    item.extra = null;
    item.el.classList.remove('playing');
    syncButton(item);
  }

  function syncButton(item) {
    if (!item.button) return;
    item.button.innerHTML = item.playing ? PAUSE_ICON : PLAY_ICON;
    item.button.setAttribute('aria-label', item.playing ? 'Pause video' : 'Play video');
  }

  /* ---- choose who plays ---- */
  function rebalance() {
    if (document.hidden) { items.forEach(stop); return; }
    var free = constrained();
    var pools = { grid: [], hero: [] };
    items.forEach(function (item) {
      if (!document.contains(item.el)) { return; }
      var pool = item.el.dataset.slot === 'hero' ? pools.hero : pools.grid;
      if (item.manual) { if (item.ratio < 0.05) { item.manual = false; stop(item); } return; }
      if (!free && item.ratio >= VISIBLE_THRESHOLD) pool.push(item);
    });
    var chosen = [];
    [[pools.grid, limit()], [pools.hero, HERO_SLOTS]].forEach(function (pair) {
      pair[0].sort(function (x, y) { return y.ratio - x.ratio; });
      chosen = chosen.concat(pair[0].slice(0, pair[1]));
    });
    items.forEach(function (item) {
      if (item.manual) return;
      if (chosen.indexOf(item) >= 0) start(item);
      else stop(item);
    });
  }

  function onIntersect(entries) {
    entries.forEach(function (entry) {
      var item = items.filter(function (i) { return i.el === entry.target; })[0];
      if (!item) return;
      item.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
    });
    rebalance();
  }

  function register(el) {
    if (items.some(function (i) { return i.el === el; })) return;
    var item = { el: el, ratio: 0, playing: false, manual: false, button: null };
    items.push(item);
    if (constrained()) addButton(item);
    io.observe(el);
  }

  function addButton(item) {
    if (item.button) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'playbtn';
    item.button = b;
    syncButton(item);
    b.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (item.playing) { item.manual = false; stop(item); } else { item.manual = true; start(item); }
    });
    item.el.appendChild(b);
  }

  var Video = {
    constrained: constrained,
    limit: limit,
    mount: function (root) {
      if (!io) {
        io = new IntersectionObserver(onIntersect, { rootMargin: ROOT_MARGIN, threshold: [0, 0.1, VISIBLE_THRESHOLD, 0.6, 1] });
      }
      // forget frames that left the page
      items = items.filter(function (item) {
        if (document.contains(item.el)) return true;
        stop(item);
        io.unobserve(item.el);
        return false;
      });
      (root || document).querySelectorAll('[data-video]').forEach(register);
    },
    /** For tests: which clips are playing right now. */
    playing: function () {
      return items.filter(function (i) { return i.playing; }).length;
    },
  };

  document.addEventListener('visibilitychange', rebalance);
  mqPhone.addEventListener('change', function () { items.forEach(stop); rebalance(); });
  mqReduce.addEventListener('change', function () {
    items.forEach(function (item) { stop(item); if (constrained()) addButton(item); });
    rebalance();
  });
  window.PROTO_VIDEO = Video;
})();
