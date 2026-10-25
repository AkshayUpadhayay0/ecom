/* Router and page shell. Hash routes (#/shop?type=gown) so it works from a plain folder, offline. */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;
  var V = window.PROTO_VIDEO;
  var NAME = 'Urban Ìbílé';

  var routes = (window.PROTO_SCREENS || []).map(function (pair) {
    var keys = [];
    var re = new RegExp('^' + pair[0].replace(/:([a-z]+)/g, function (_m, k) { keys.push(k); return '([^/]+)'; }) + '$');
    return { re: re, keys: keys, render: pair[1] };
  });

  function parse() {
    var raw = location.hash.replace(/^#/, '') || '/';
    var i = raw.indexOf('?');
    var path = i < 0 ? raw : raw.slice(0, i);
    var query = {};
    new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)).forEach(function (v, k) { query[k] = v; });
    return { path: path, query: query };
  }

  var heroObserver = null;
  var parallax = null;

  function setHeader(overHero) {
    var header = U.$('#site-header');
    header.dataset.state = overHero ? 'over-hero' : 'solid';
    header.classList.toggle('on-dark', overHero);
    U.$('#header-spacer').hidden = overHero;
    if (heroObserver) { heroObserver.disconnect(); heroObserver = null; }
    if (!overHero) return;
    var hero = U.$('[data-hero]');
    if (!hero) { header.dataset.state = 'solid'; header.classList.remove('on-dark'); return; }
    heroObserver = new IntersectionObserver(function (entries) {
      var past = !entries[0].isIntersecting;
      header.dataset.state = past ? 'solid' : 'over-hero';
      header.classList.toggle('on-dark', !past);
    }, { rootMargin: '-72px 0px 0px 0px' });
    heroObserver.observe(hero);
  }

  function setParallax() {
    if (parallax) { window.removeEventListener('scroll', parallax); parallax = null; }
    var frames = U.$$('[data-parallax]');
    if (!frames.length || V.constrained()) return;
    var ticking = false;
    parallax = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        frames.forEach(function (el) {
          var r = el.parentElement.getBoundingClientRect();
          var mid = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
          el.style.transform = 'translateY(' + (Math.max(-1, Math.min(1, mid)) * -36).toFixed(1) + 'px)';
        });
        ticking = false;
      });
    };
    window.addEventListener('scroll', parallax, { passive: true });
    parallax();
  }

  var first = true;
  function render() {
    var loc = parse();
    var match = null;
    var params = {};
    routes.some(function (r) {
      var m = r.re.exec(loc.path);
      if (!m) return false;
      match = r;
      r.keys.forEach(function (k, i) { params[k] = decodeURIComponent(m[i + 1]); });
      return true;
    });
    var main = U.$('#main');
    var out = match ? match.render(params, loc.query) : { title: 'Not found', html: '<div class="wrap page"><h1 class="t-head">Page not found</h1><p><a class="link" href="#/">Back to home</a></p></div>' };
    main.innerHTML = out.html;
    document.title = out.title + ' | ' + NAME + ' (design proposal v3)';
    setHeader(Boolean(out.hero));
    V.mount(main);
    setParallax();
    if (out.after) out.after(main, params, loc.query);
    if (!first) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
      U.$('#live').textContent = out.title;
    }
    first = false;
  }

  function init() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    document.documentElement.classList.toggle('constrained', V.constrained());
    U.shell();
    window.addEventListener('hashchange', render);
    render();
  }
  init();
})();
