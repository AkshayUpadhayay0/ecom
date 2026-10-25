/* Shared pieces: components, cart, side menu, search overlay with suggestions, cart drawer, guide. */
(function () {
  'use strict';
  var D = window.PROTO;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var ICON = {
    search: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/></svg>',
    user: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/></svg>',
    bag: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    menu: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18M3 16h18"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>',
  };

  /* ---------- components ---------- */
  /** Video frame: poster first, the clip is loaded and played by video.js only while visible. */
  function vframe(id, opts) {
    opts = opts || {};
    var ratio = opts.ratio ? ' data-ratio="' + opts.ratio + '"' : '';
    var slot = opts.slot ? ' data-slot="' + opts.slot + '"' : '';
    return (
      '<div class="vframe"' + ratio + slot + ' data-video="media/video/' + id + '.mp4">' +
      '<img src="media/poster/' + id + '.webp" alt="' + esc(opts.alt || '') + '" width="640" height="800" loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async">' +
      '<span class="sample" aria-hidden="true">Sample</span></div>'
    );
  }

  function card(p, opts) {
    opts = opts || {};
    var t = D.typeOf(p.type);
    return (
      '<article class="card' + (p.soldOut ? ' sold' : '') + '" data-product="' + p.id + '">' +
      '<div class="media">' + vframe(p.id, { ratio: '4/5', alt: '' }) +
      (p.soldOut ? '<span class="soldtag">Sold out</span>' : '') +
      (opts.quick && !p.soldOut ? '<button type="button" class="btn small quick" data-quick="' + p.id + '">Quick add</button>' : '') +
      '</div><div class="meta"><div><span class="no">' + p.no + ' · ' + esc(t ? t.name : '') + '</span>' +
      '<h3 class="name"><a href="#/product/' + p.slug + '">' + esc(p.name) + '</a></h3></div>' +
      '<span class="price">' + D.money(p.priceNaira) + '</span></div></article>'
    );
  }

  function toast(text) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    window.setTimeout(function () { el.remove(); }, 2600);
  }

  /* ---------- cart ---------- */
  var Cart = {
    count: function () {
      return D.state.cart.reduce(function (n, l) { return n + l.qty; }, 0);
    },
    subtotal: function () {
      return D.state.cart.reduce(function (n, l) { return n + D.byId(l.product).priceNaira * l.qty; }, 0);
    },
    add: function (product, size, qty, fit) {
      var lines = D.state.cart;
      var found = lines.filter(function (l) { return l.product === product && l.size === size; })[0];
      if (found) found.qty += qty;
      else lines.push({ product: product, size: size, qty: qty, fit: fit || 'direct' });
      D.save();
      Cart.refresh();
    },
    setQty: function (index, qty) {
      var line = D.state.cart[index];
      if (!line) return;
      if (qty < 1) D.state.cart.splice(index, 1);
      else line.qty = Math.min(qty, D.byId(line.product).stock[line.size] || 10, 10);
      D.save();
      Cart.refresh();
    },
    clear: function () { D.state.cart = []; D.save(); Cart.refresh(); },
    refresh: function () {
      $$('[data-cart-count]').forEach(function (el) { el.textContent = String(Cart.count()); });
      var cartBtn = $('#cart-open');
      if (cartBtn) cartBtn.setAttribute('aria-label', 'Open cart, ' + Cart.count() + ' items');
      var drawer = $('#cart-drawer');
      if (drawer && drawer.open) renderDrawer();
      document.dispatchEvent(new CustomEvent('proto:cart'));
    },
  };

  function fitLabel(line) {
    if (line.fit === 'recommended') return 'Recommended for your measurements';
    if (line.fit === 'choice') return 'Your choice';
    return '';
  }

  function lineHtml(line, i, editable) {
    var p = D.byId(line.product);
    return (
      '<li class="line">' + vframe(p.id, { ratio: '4/5' }) +
      '<div><b>' + esc(p.name) + '</b><small>Size ' + esc(line.size) + '</small>' +
      (fitLabel(line) ? '<small>' + fitLabel(line) + '</small>' : '') +
      (editable
        ? '<div class="qty" role="group" aria-label="Quantity of ' + esc(p.name) + '">' +
          '<button type="button" data-qty="-1" data-i="' + i + '" aria-label="Decrease quantity of ' + esc(p.name) + '">−</button>' +
          '<output aria-live="polite">' + line.qty + '</output>' +
          '<button type="button" data-qty="1" data-i="' + i + '" aria-label="Increase quantity of ' + esc(p.name) + '">+</button></div>' +
          '<button type="button" class="link" data-remove="' + i + '" style="border:0;background:none;padding:.5rem 0;min-height:2.75rem;text-decoration:underline;text-underline-offset:.3em">Remove</button>'
        : '<small>Quantity ' + line.qty + '</small>') +
      '</div><b class="price">' + D.money(p.priceNaira * line.qty) + '</b></li>'
    );
  }

  function renderDrawer() {
    var body = $('#cart-body');
    var lines = D.state.cart;
    if (!lines.length) {
      body.innerHTML =
        '<div class="drawer-lines"><p class="empty wrap" style="padding-inline:1.25rem">Your cart is empty.</p></div>' +
        '<div class="drawer-foot"><a class="btn ghost full" href="#/shop" data-close>Continue shopping</a></div>';
    } else {
      body.innerHTML =
        '<ul class="drawer-lines">' + lines.map(function (l, i) { return lineHtml(l, i, true); }).join('') + '</ul>' +
        '<div class="drawer-foot"><div class="sumrow"><span>Subtotal</span><span class="price">' + D.money(Cart.subtotal()) + '</span></div>' +
        '<p>Delivery is added at checkout.</p>' +
        '<a class="btn full" href="#/checkout" data-close>Checkout</a>' +
        '<p style="margin:.9rem 0 0;text-align:center"><a href="#/cart" data-close>View cart</a></p></div>';
    }
    window.PROTO_VIDEO.mount(body);
  }

  /* ---------- dialogs ---------- */
  function openDialog(dlg) {
    if (!dlg.open) dlg.showModal();
  }
  function wireDialog(dlg) {
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) dlg.close();
      var close = e.target.closest && e.target.closest('[data-close]');
      if (close) dlg.close();
    });
  }

  function menuHtml() {
    var types = D.TYPES.map(function (t) {
      return '<li><a class="row-link sub" data-close href="#/shop?type=' + t.slug + '">' + esc(t.name) + '</a></li>';
    }).join('');
    var signed = D.state.signedIn;
    return (
      '<div class="dlg-head"><b>Menu</b><button type="button" class="icon-btn" data-close aria-label="Close menu">' + ICON.close + '</button></div>' +
      '<nav aria-label="Menu"><ul>' +
      '<li><a class="row-link" data-close href="#/shop">Shop</a></li>' + types +
      (signed ? '<li><a class="row-link" data-close href="#/orders">My orders</a></li>' : '') +
      '<li><a class="row-link" data-close href="' + (signed ? '#/account' : '#/signin') + '">' + (signed ? 'Account' : 'Sign in') + '</a></li>' +
      '</ul></nav>' +
      ''
    );
  }

  /* ---------- search with suggestions ---------- */
  var NO_RESULTS = 'No outfits found. Try another word.';
  function suggestions(q) {
    var term = D.plain(q).trim();
    if (!term) return { types: [], products: [] };
    var types = D.TYPES.filter(function (t) { return D.plain(t.name + ' ' + t.keywords).indexOf(term) >= 0; });
    var products = D.PRODUCTS.filter(function (p) {
      var t = D.typeOf(p.type);
      return D.plain(p.name + ' ' + (t ? t.name + ' ' + t.keywords : '')).indexOf(term) >= 0;
    });
    return { types: types, products: products };
  }

  function wireSearch() {
    var dlg = $('#search-dialog');
    var input = $('#search-input');
    var list = $('#suggest');
    var active = -1;

    function options() { return $$('[role=option]', list); }
    function setActive(i) {
      var opts = options();
      opts.forEach(function (o, n) { o.setAttribute('aria-selected', n === i ? 'true' : 'false'); });
      active = i;
      if (opts[i]) input.setAttribute('aria-activedescendant', opts[i].id);
      else input.removeAttribute('aria-activedescendant');
    }
    function render() {
      var q = input.value.trim();
      active = -1;
      input.removeAttribute('aria-activedescendant');
      if (!q) {
        list.innerHTML =
          '<p class="t-label muted" style="margin-bottom:.75rem">Shop by type</p><div class="chips">' +
          D.TYPES.map(function (t) { return '<a class="chip" data-close href="#/shop?type=' + t.slug + '">' + esc(t.name) + '</a>'; }).join('') + '</div>';
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      var s = suggestions(q);
      if (!s.types.length && !s.products.length) {
        list.innerHTML = '<p class="empty" role="status">' + NO_RESULTS + '</p>';
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      var n = 0;
      var rows = s.types.map(function (t) {
        return '<li role="presentation"><a role="option" id="sg' + (n++) + '" aria-selected="false" class="sug" data-close href="#/shop?type=' + t.slug + '"><span class="grow">Shop ' + esc(t.name) + '</span><span aria-hidden="true">→</span></a></li>';
      }).concat(s.products.slice(0, 5).map(function (p) {
        var t = D.typeOf(p.type);
        return '<li role="presentation"><a role="option" id="sg' + (n++) + '" aria-selected="false" class="sug" data-close href="#/product/' + p.slug + '"><img src="media/poster/' + p.id + '.webp" alt="" width="48" height="60"><span class="grow">' + esc(p.name) + '<small>' + esc(t.name) + '</small></span><span class="price">' + D.money(p.priceNaira) + '</span></a></li>';
      }));
      rows.push('<li role="presentation"><a role="option" id="sg' + (n++) + '" aria-selected="false" class="sug" data-close href="#/search?q=' + encodeURIComponent(q) + '"><span class="grow">See all results for “' + esc(q) + '”</span><span aria-hidden="true">→</span></a></li>');
      list.innerHTML = '<ul role="listbox" id="suggest-list" aria-label="Suggestions">' + rows.join('') + '</ul>';
      input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      var opts = options();
      if (e.key === 'Escape') { e.preventDefault(); dlg.close(); return; }
      if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); setActive((active + 1) % opts.length); }
      else if (e.key === 'ArrowUp' && opts.length) { e.preventDefault(); setActive((active - 1 + opts.length) % opts.length); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var q = input.value.trim();
        if (opts[active]) { opts[active].click(); return; }
        dlg.close();
        location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/search';
      }
    });
    $('#search-open').addEventListener('click', function () {
      input.value = '';
      render();
      openDialog(dlg);
      input.focus();
    });
  }

  /* ---------- guide ---------- */
  var GUIDE = [
    ['Browse', [['Home', '#/'], ['Shop', '#/shop'], ['Shop: one clothing type', '#/shop?type=blazer'], ['Search results', '#/search?q=blazer'], ['Search: no result', '#/search?q=zzzz']]],
    ['Product', [['Product with Find My Size', '#/product/sample-outfit-03'], ['Product without Blueprint', '#/product/sample-outfit-08'], ['Sold-out product', '#/product/sample-outfit-06']]],
    ['Find My Size', [['Measurements (Quick Fit)', '#/fit/sample-outfit-03'], ['Out-of-range example', '#/fit/sample-outfit-03?demo=range'], ['Height and weight (concept)', '#/fit-concept']]],
    ['Buy', [['Cart', '#/cart'], ['Sign in', '#/signin'], ['Register', '#/register'], ['Checkout', '#/checkout'], ['My orders', '#/orders']]],
  ];
  function guideHtml() {
    return (
      '<div class="dlg-head"><b>Prototype guide</b><button type="button" class="icon-btn" data-close aria-label="Close guide">' + ICON.close + '</button></div>' +
      '<div class="guide-list">' +
      '<p class="note">Design proposal v3. Sample content only: nothing is saved or sent, and prices, zones and sizes are made up. Orders and sign-in are simulated.</p>' +
      GUIDE.map(function (g) {
        return '<section><h3>' + g[0] + '</h3>' + g[1].map(function (l) { return '<a data-close href="' + l[1] + '">' + l[0] + '</a>'; }).join('') + '</section>';
      }).join('') +
      '<section><h3>Tools</h3><a href="phone.html">Phone preview (390 px)</a><a href="#/" data-reset data-close>Reset the prototype (cart, sign-in, orders)</a></section></div>'
    );
  }

  /* ---------- shell ---------- */
  function shell() {
    document.body.insertAdjacentHTML('afterbegin',
      '<a class="skip" href="#main">Skip to main content</a>' +
      '<header class="site-header" data-state="solid" id="site-header"><div class="bar">' +
      '<div class="left"><button type="button" class="menu-btn" id="menu-open" aria-label="Open menu">' + ICON.menu + '<span>Menu</span></button></div>' +
      '<a class="logo" href="#/" aria-label="Urban Ìbílé, home"><img class="logo-hero" src="assets/brand/wordmark-warm-ivory.svg" alt="" width="250" height="35"><img class="logo-solid" src="assets/brand/wordmark-ink-black.svg" alt="" width="250" height="35"></a>' +
      '<nav class="right" aria-label="Main navigation">' +
      '<button type="button" class="icon-btn" id="search-open" aria-label="Open search">' + ICON.search + '</button>' +
      '<a class="icon-btn" id="account-link" href="#/signin" aria-label="Sign in">' + ICON.user + '</a>' +
      '<button type="button" class="icon-btn" id="cart-open" aria-label="Open cart">' + ICON.bag + '<span class="badge" data-cart-count>0</span></button>' +
      '</nav></div></header>' +
      '<div class="spacer" id="header-spacer" hidden></div>' +
      '<main id="main" tabindex="-1" style="outline:none"></main>' +
      '<footer class="site-footer"><div class="wrap"><p>© 2026 Urban Ìbílé</p><p class="muted" style="font-size:.8125rem">Design proposal v3: sample content</p></div></footer>' +
      '<button type="button" class="guide-btn" id="guide-open">Prototype guide</button>' +
      '<div id="live" class="sr-only" aria-live="polite"></div>' +
      '<dialog id="menu-dialog" class="panel-left" aria-label="Menu"></dialog>' +
      '<dialog id="search-dialog" class="panel-search" aria-label="Search"><div class="dlg-head"><b>Search</b><button type="button" class="icon-btn" data-close aria-label="Close search">' + ICON.close + '</button></div>' +
      '<div class="search-wrap"><div class="search-field">' + ICON.search +
      '<input id="search-input" type="search" role="combobox" aria-expanded="false" aria-controls="suggest-list" aria-autocomplete="list" aria-label="Search outfits" placeholder="Search outfits" autocomplete="off" enterkeyhint="search" maxlength="80"></div>' +
      '<div class="suggest" id="suggest"></div></div></dialog>' +
      '<dialog id="cart-drawer" class="panel-right" aria-label="Your cart"><div class="drawer-body"><div class="dlg-head"><b>Your cart</b><button type="button" class="icon-btn" data-close aria-label="Close cart">' + ICON.close + '</button></div><div id="cart-body" style="display:flex;flex-direction:column;flex:1;min-height:0"></div></div></dialog>' +
      '<dialog id="sheet" class="sheet" aria-label="Quick add"></dialog>' +
      '<dialog id="guide" class="panel-right" aria-label="Prototype guide"></dialog>'
    );
    ['menu-dialog', 'search-dialog', 'cart-drawer', 'sheet', 'guide'].forEach(function (id) { wireDialog($('#' + id)); });

    $('#menu-open').addEventListener('click', function () {
      $('#menu-dialog').innerHTML = menuHtml();
      openDialog($('#menu-dialog'));
    });
    $('#cart-open').addEventListener('click', function () {
      renderDrawer();
      openDialog($('#cart-drawer'));
    });
    $('#guide-open').addEventListener('click', function () {
      $('#guide').innerHTML = guideHtml();
      openDialog($('#guide'));
    });
    document.addEventListener('click', function (e) {
      var q = e.target.closest && e.target.closest('[data-qty]');
      if (q) { Cart.setQty(Number(q.dataset.i), D.state.cart[Number(q.dataset.i)].qty + Number(q.dataset.qty)); return; }
      var r = e.target.closest && e.target.closest('[data-remove]');
      if (r) { Cart.setQty(Number(r.dataset.remove), 0); return; }
      var reset = e.target.closest && e.target.closest('[data-reset]');
      if (reset) { D.reset(); Cart.refresh(); syncAccount(); toast('Prototype reset.'); }
    });
    wireSearch();
    syncAccount();
    Cart.refresh();
  }

  function syncAccount() {
    var a = $('#account-link');
    if (!a) return;
    a.setAttribute('href', D.state.signedIn ? '#/account' : '#/signin');
    a.setAttribute('aria-label', D.state.signedIn ? 'Account' : 'Sign in');
  }

  window.PROTO_UI = {
    esc: esc, $: $, $$: $$, ICON: ICON, vframe: vframe, card: card, toast: toast, Cart: Cart,
    lineHtml: lineHtml, shell: shell, syncAccount: syncAccount, NO_RESULTS: NO_RESULTS,
    suggestions: suggestions, openDialog: openDialog,
  };
})();
