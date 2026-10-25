/* Home: runway hero, one video band, category tiles, "New outfits" carousel, one button. */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;

  /* REEL NOTES HOOK (hero).
   * The client will send notes from their Instagram reel screen recording. Nothing here is a guess:
   * the values below are neutral defaults. When the notes arrive, set:
   *   pace         -> playbackRate (1 = clip speed) and crossfadeMs (how long the loop blends)
   *   framing      -> objectPosition (where the model sits in the frame, e.g. '50% 20%')
   *   overlayText  -> text shown over the video (null = none)
   * video.js reads this object; nothing else needs to change. */
  window.PROTO_HERO = {
    playbackRate: 1,
    crossfadeMs: 700,
    objectPosition: '50% 50%',
    overlayText: null,
  };

  function hero() {
    var h = window.PROTO_HERO;
    var overlay = h.overlayText ? '<p class="hero-overlay t-label">' + U.esc(h.overlayText) + '</p>' : '';
    return (
      '<section class="hero on-dark" data-hero aria-label="Featured video">' +
      '<div class="vframe runway" data-video="media/video/hero-wide.mp4" data-src-tall="media/video/hero-tall.mp4" data-runway="1" data-slot="hero">' +
      '<div class="layer"><picture><source media="(max-width: 767px)" srcset="media/poster/hero-tall.webp" width="720" height="1366">' +
      '<img src="media/poster/hero-wide.webp" alt="" width="1280" height="675" fetchpriority="high" decoding="async" style="object-position:' + U.esc(h.objectPosition) + '"></picture></div>' +
      '<span class="sample" aria-hidden="true">Sample</span></div>' +
      '<div class="shade"></div>' +
      '<div class="copy">' + overlay +
      '<h1 class="t-display">Urban Ìbílé</h1>' +
      '<p class="intro">[Introductory message: supplied by the client]</p>' +
      '<a class="btn" href="#/shop">Shop</a></div>' +
      '<div class="cue" aria-hidden="true"><i></i>Scroll</div>' +
      '</section>'
    );
  }

  function band() {
    return (
      '<section class="band on-dark" aria-label="Featured band">' +
      U.vframe('band', { slot: 'hero' }).replace('class="vframe"', 'class="vframe" data-parallax') +
      '<div class="shade"></div><div class="in"><h2 class="t-band">[Band headline: supplied by the client]</h2></div></section>'
    );
  }

  function tiles() {
    return (
      '<section class="section wrap"><div class="sechead"><h2 class="t-label" id="types-h">Shop by type</h2>' +
      '<a class="link" href="#/shop">All outfits →</a></div><ul class="tiles">' +
      D.TYPES.map(function (t) {
        return '<li><a class="tile" href="#/shop?type=' + t.slug + '"><img src="media/poster/' + t.tile + '.webp" alt="" width="640" height="800" loading="lazy" decoding="async"><i class="sample" aria-hidden="true">Sample</i><span>' + U.esc(t.name) + '<span aria-hidden="true">→</span></span></a></li>';
      }).join('') +
      '</ul></section>'
    );
  }

  function carousel() {
    var fresh = D.PRODUCTS.filter(function (p) { return !p.soldOut; }).slice(0, 8);
    return (
      '<section class="section wrap"><div class="sechead"><h2 class="t-label" id="new-h">New outfits</h2>' +
      '<div class="arrows"><button type="button" class="arrow" data-scroll="-1" aria-label="Previous outfits">←</button>' +
      '<button type="button" class="arrow" data-scroll="1" aria-label="Next outfits">→</button></div></div>' +
      '<div class="carousel" role="region" aria-label="New outfits" tabindex="0"><ul class="track">' +
      fresh.map(function (p) { return '<li>' + U.card(p) + '</li>'; }).join('') +
      '</ul></div></section>'
    );
  }

  function render() {
    return {
      title: 'Home',
      hero: true,
      html:
        hero() + '<div class="tape" aria-hidden="true"></div>' + band() + tiles() + carousel() +
        '<div class="end"><a class="btn ghost" href="#/shop">See every outfit</a></div>',
      after: function (root) {
        var track = U.$('.carousel', root);
        U.$$('[data-scroll]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            track.scrollBy({ left: Number(b.dataset.scroll) * track.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
          });
        });
        track.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * track.clientWidth * 0.6 });
          }
        });
      },
    };
  }

  (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push(['/', render]);
})();
