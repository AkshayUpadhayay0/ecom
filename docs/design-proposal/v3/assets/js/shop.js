/* Shop (video-led grid, type chips, sort menu, sold-out state, pagination), search results, quick add. */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;

  var SORTS = [
    ['newest', 'Newest'],
    ['price_asc', 'Price: low to high'],
    ['price_desc', 'Price: high to low'],
    ['name', 'Name'],
  ];

  function sortList(list, sort) {
    var out = list.slice();
    if (sort === 'price_asc') out.sort(function (a, b) { return a.priceNaira - b.priceNaira; });
    else if (sort === 'price_desc') out.sort(function (a, b) { return b.priceNaira - a.priceNaira; });
    else if (sort === 'name') out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  function href(base, s) {
    var q = new URLSearchParams();
    if (s.q) q.set('q', s.q);
    if (s.type) q.set('type', s.type);
    if (s.sort && s.sort !== 'newest') q.set('sort', s.sort);
    if (s.page && s.page > 1) q.set('page', String(s.page));
    var text = q.toString();
    return '#' + base + (text ? '?' + text : '');
  }

  function pager(base, s, pages) {
    if (pages <= 1) return '';
    var links = [];
    var prev = s.page > 1 ? href(base, Object.assign({}, s, { page: s.page - 1 })) : null;
    var next = s.page < pages ? href(base, Object.assign({}, s, { page: s.page + 1 })) : null;
    if (prev) links.push('<a href="' + prev + '" rel="prev">Previous</a>');
    for (var i = 1; i <= pages; i += 1) {
      links.push(i === s.page
        ? '<span class="cur" aria-current="page"><span class="sr-only">Page </span>' + i + '</span>'
        : '<a href="' + href(base, Object.assign({}, s, { page: i })) + '"><span class="sr-only">Page </span>' + i + '</a>');
    }
    if (next) links.push('<a href="' + next + '" rel="next">Next</a>');
    return '<nav class="pager" aria-label="Pagination">' + links.join('') + '</nav>';
  }

  function gridHtml(list) {
    return '<ul class="grid">' + list.map(function (p) { return '<li>' + U.card(p, { quick: true }) + '</li>'; }).join('') + '</ul>';
  }

  function shop(_params, query) {
    var type = D.typeOf(query.type) ? query.type : '';
    var sort = SORTS.some(function (s) { return s[0] === query.sort; }) ? query.sort : 'newest';
    var all = sortList(D.PRODUCTS.filter(function (p) { return !type || p.type === type; }), sort);
    var pages = Math.max(1, Math.ceil(all.length / D.PAGE_SIZE));
    var page = Math.min(Math.max(parseInt(query.page || '1', 10) || 1, 1), pages);
    var shown = all.slice((page - 1) * D.PAGE_SIZE, page * D.PAGE_SIZE);
    var s = { type: type, sort: sort, page: page };

    var chips = '<li><a class="chip" href="#/shop"' + (!type ? ' aria-current="page"' : '') + '>All</a></li>' +
      D.TYPES.map(function (t) {
        return '<li><a class="chip" href="' + href('/shop', { type: t.slug }) + '"' + (type === t.slug ? ' aria-current="page"' : '') + '>' + U.esc(t.name) + '</a></li>';
      }).join('');
    var sortSel = '<div class="sortbox"><label for="sort">Sort by</label><select id="sort" class="select">' +
      SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sort ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';

    return {
      title: type ? D.typeOf(type).name : 'Shop',
      html:
        '<div class="wrap page"><h1 class="t-head" style="margin-bottom:1.5rem">Shop</h1>' +
        '<div class="toolbar"><nav aria-label="Clothing type"><ul class="chips">' + chips + '</ul></nav>' + sortSel + '</div>' +
        gridHtml(shown) + pager('/shop', s, pages) + '</div>',
      after: function (root) {
        U.$('#sort', root).addEventListener('change', function (e) {
          location.hash = href('/shop', { type: type, sort: e.target.value });
        });
      },
    };
  }

  function search(_params, query) {
    var q = String(query.q || '').trim().slice(0, 80);
    var form =
      '<form class="search-form" role="search" id="page-search"><label class="sr-only" for="page-q">Search outfits</label>' +
      '<input id="page-q" class="input" type="search" name="q" value="' + U.esc(q) + '" maxlength="80" autocomplete="off" placeholder="Search outfits">' +
      '<button class="btn small" type="submit">Search</button></form>';
    if (!q) {
      return {
        title: 'Search',
        html: '<div class="wrap page"><h1 class="t-head">Search</h1>' + form + '<p style="margin-top:1.25rem">Type a word to search every outfit.</p></div>',
        after: wireSearchForm,
      };
    }
    var s = U.suggestions(q);
    var seen = {};
    var found = s.products.filter(function (p) { if (seen[p.id]) return false; seen[p.id] = true; return true; });
    var sort = SORTS.some(function (o) { return o[0] === query.sort; }) ? query.sort : 'newest';
    found = sortList(found, sort);
    var pages = Math.max(1, Math.ceil(found.length / D.PAGE_SIZE));
    var page = Math.min(Math.max(parseInt(query.page || '1', 10) || 1, 1), pages);
    var shown = found.slice((page - 1) * D.PAGE_SIZE, page * D.PAGE_SIZE);
    var body = !found.length
      ? '<p class="empty" role="status">' + U.NO_RESULTS + '</p>'
      : '<p class="muted" style="margin-bottom:1.5rem">' + found.length + ' found</p>' + gridHtml(shown) + pager('/search', { q: q, sort: sort, page: page }, pages);
    return {
      title: 'Search: ' + q,
      html: '<div class="wrap page"><h1 class="t-head">Results for “' + U.esc(q) + '”</h1>' + form + '<div style="margin-top:2rem">' + body + '</div></div>',
      after: wireSearchForm,
    };
  }

  function wireSearchForm(root) {
    var form = U.$('#page-search', root);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = U.$('#page-q', root).value.trim();
      location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/search';
    });
  }

  /* ---------- quick add ---------- */
  var sheetState = { id: null, size: null };

  function sheetHtml(p) {
    var t = D.typeOf(p.type);
    var direct = !p.profile;
    var chips = p.sizes.map(function (sz) {
      var st = D.stockState(p, sz);
      var label = '';
      return direct
        ? '<button type="button" class="size" data-size="' + sz + '" aria-pressed="' + (sheetState.size === sz) + '"' + (st === 'out' ? ' disabled' : '') + '><span class="sr-only">Size </span><b>' + sz + '</b><small>' + (st === 'in' ? '' : D.STOCK_TEXT[st]) + '</small></button>'
        : '<li class="size static' + (st === 'out' ? ' off' : '') + '"><span class="sr-only">Size </span><b>' + sz + '</b><small>' + (st === 'in' ? '' : D.STOCK_TEXT[st]) + '</small></li>';
    }).join('');
    return (
      '<div class="dlg-head"><b>Quick add</b><button type="button" class="icon-btn" data-close aria-label="Close quick add">' + U.ICON.close + '</button></div>' +
      '<div class="sheet-body"><div class="sheet-top">' + U.vframe(p.id, { ratio: '4/5' }) +
      '<div><b>' + U.esc(p.name) + '</b><small>' + U.esc(t.name) + '</small></div><b class="price">' + D.money(p.priceNaira) + '</b></div>' +
      '<div class="block" style="margin-top:0"><h2 id="qa-sizes">Sizes</h2>' +
      (direct
        ? '<p class="helper" style="margin:0 0 .7rem">This outfit has no Blueprint fit. Pick the size you want.</p><div class="sizes" role="group" aria-labelledby="qa-sizes">' + chips + '</div>'
        : '<p class="helper" style="margin:0 0 .7rem">This outfit is sized from your body measurements. Use Find my size and we will recommend a size; you can then keep it or choose another.</p><ul class="sizes" aria-labelledby="qa-sizes">' + chips + '</ul>') +
      '</div><p class="err" id="qa-err" role="alert" style="margin-top:.7rem" hidden>Choose a size to continue.</p>' +
      '<div class="actions" style="margin-top:1.25rem">' +
      (direct
        ? '<button type="button" class="btn full" id="qa-add">Add to cart</button>'
        : '<a class="btn full" href="#/fit/' + p.slug + '" data-close>Find my size</a>') +
      '<a class="btn ghost full" href="#/product/' + p.slug + '" data-close>View outfit</a></div></div>'
    );
  }

  function openSheet(id, withFocusSizes) {
    var p = D.byId(id);
    if (!p) return;
    sheetState = { id: id, size: null };
    var dlg = U.$('#sheet');
    dlg.innerHTML = sheetHtml(p);
    window.PROTO_VIDEO.mount(dlg);
    U.openDialog(dlg);
    if (withFocusSizes) { var first = U.$('.size:not([disabled])', dlg); if (first) first.focus(); }
  }

  function wireSheet() {
    document.addEventListener('click', function (e) {
      var q = e.target.closest && e.target.closest('[data-quick]');
      if (q) { e.preventDefault(); openSheet(q.dataset.quick, true); return; }
      var dlg = U.$('#sheet');
      if (!dlg || !dlg.open || !dlg.contains(e.target)) return;
      var size = e.target.closest('[data-size]');
      if (size) {
        sheetState.size = size.dataset.size;
        U.$$('[data-size]', dlg).forEach(function (b) { b.setAttribute('aria-pressed', String(b === size)); });
        U.$('#qa-err', dlg).hidden = true;
        return;
      }
      if (e.target.closest('#qa-add')) {
        if (!sheetState.size) { U.$('#qa-err', dlg).hidden = false; return; }
        U.Cart.add(sheetState.id, sheetState.size, 1, 'direct');
        dlg.close();
        U.toast('Added to your cart.');
        U.openCart();
      }
    });
  }

  window.PROTO_SHEET = { open: openSheet };
  wireSheet();
  (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push(['/shop', shop], ['/search', search]);
})();
