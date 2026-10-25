/* Product page: video first, details beside it, sizes, Find My Size, quantity, Add to cart (sticky on
 * phone), collapsible Description / Material / Delivery / Returns, similar outfits. */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;

  var DESCRIPTION = '[Description: from Admin → Product.] This text is always in the page as real, readable text. When it is collapsed it is only shortened on screen, so search engines, screen readers and find-in-page still see all of it.';

  function notFound() {
    return { title: 'Not found', html: '<div class="wrap page"><h1 class="t-head">Outfit not found</h1><p style="margin-top:1rem"><a class="link" href="#/shop">Back to the shop</a></p></div>' };
  }

  function fitSummary(decision) {
    if (!decision) return '';
    return (
      '<div class="your-size" data-testid="your-size"><b>Size ' + U.esc(decision.size) + '</b><span>' +
      (decision.fit === 'recommended' ? 'Recommended from your measurements' : 'Your choice (we recommended ' + U.esc(decision.recommended) + ')') + '</span></div>'
    );
  }

  function sizesBlock(p, decision, direct) {
    var chips = p.sizes.map(function (sz) {
      var st = D.stockState(p, sz);
      var label = '';
      var small = '<small>' + (st === 'in' ? '' : D.STOCK_TEXT[st]) + '</small>';
      if (direct) {
        return '<button type="button" class="size" role="radio" data-size="' + sz + '" aria-checked="' + (direct.size === sz) + '"' + (st === 'out' ? ' disabled' : '') + '><span class="sr-only">Size </span><b>' + sz + '</b>' + small + '</button>';
      }
      var on = decision && decision.size === sz;
      return '<li class="size static' + (st === 'out' ? ' off' : '') + '"' + (on ? ' aria-current="true" style="background:var(--ink);color:var(--ivory)"' : '') + '><span class="sr-only">Size </span><b>' + sz + '</b>' + small + '<span class="sr-only">' + (st === 'in' ? '' : ', ' + D.STOCK_TEXT[st].toLowerCase()) + (on ? ', your size' : '') + '</span></li>';
    }).join('');
    return (
      '<section class="block" aria-labelledby="sizes-h"><h2 id="sizes-h">Sizes <small>[Size chart]</small></h2>' +
      (direct
        ? '<p class="helper" style="margin:0 0 .7rem">This outfit has no Blueprint fit. Pick the size you want.</p><div class="sizes" role="radiogroup" aria-labelledby="sizes-h">' + chips + '</div>'
        : '<p class="helper" style="margin:0 0 .7rem">This outfit is sized from your body measurements. Use Find my size and we will recommend a size; you can then keep it or choose another.</p><ul class="sizes" aria-labelledby="sizes-h">' + chips + '</ul>') +
      '</section>'
    );
  }

  function fmsBlock(p, decision) {
    return (
      '<section class="fms-block" aria-labelledby="fms-h"><div class="tape" aria-hidden="true"></div><h3 id="fms-h">Find my size</h3>' +
      '<p>' + (decision ? 'Your size is saved with your measurements.' : 'Enter your body measurements in inches. We match them to our size chart to recommend your size.') + '</p>' +
      '<a class="btn" href="#/fit/' + p.slug + '">' + (decision ? 'Find my size again' : 'Find my size') + '</a></section>'
    );
  }

  function deliveryHtml() {
    return (
      '<p class="copy">[Delivery: from Admin → Delivery and Content. Sample text in brackets.]</p><ul class="zones">' +
      D.ZONES.map(function (z) { return '<li><span>' + U.esc(z.name) + '</span><span class="price">' + D.money(z.feeNaira) + ' · ' + z.days + '</span></li>'; }).join('') + '</ul>'
    );
  }

  function render(params) {
    var p = D.bySlug(params.slug);
    if (!p) return notFound();
    var t = D.typeOf(p.type);
    var similar = D.PRODUCTS.filter(function (o) { return o.type === p.type && o.id !== p.id; }).slice(0, 6);
    var state = { size: null, qty: 1 };

    function decision() { return p.profile ? D.state.fits[p.slug] || null : null; }
    function chosenSize() { return p.profile ? (decision() ? decision().size : null) : state.size; }

    function buyHtml() {
      var dec = decision();
      var size = chosenSize();
      var sizeStock = size ? (p.stock[size] || 0) : 0;
      var soldOut = p.soldOut;
      var needSize = !size;
      var disabled = soldOut || (p.profile && !dec) || (!p.profile && needSize) || (size && sizeStock === 0);
      var helper = soldOut ? 'Out of stock' : needSize ? (p.profile ? 'Find your size first to continue.' : 'Choose a size to continue.') : (sizeStock === 0 ? 'Size ' + size + ' is out of stock right now.' : '');
      return (
        sizesBlock(p, dec, p.profile ? null : state) +
        (p.profile && !soldOut ? fmsBlock(p, dec) + fitSummary(dec) : '') +
        '<div class="buyrow"><div class="qty" role="group" aria-label="Quantity"><button type="button" data-q="-1" aria-label="Decrease quantity">−</button><output id="qty" aria-live="polite">' + state.qty + '</output><button type="button" data-q="1" aria-label="Increase quantity">+</button></div>' +
        '<button type="button" class="btn" id="add"' + (disabled ? ' disabled' : '') + '>Add to cart</button></div>' +
        (helper ? '<p class="helper" id="helper" role="status">' + helper + '</p>' : '<p class="helper" id="helper" role="status"></p>')
      );
    }

    var html =
      '<div id="pdp-scope"><div class="wrap page"><div class="pdp">' +
      '<div class="gallery">' + U.vframe(p.media, { ratio: '4/5', alt: p.name, eager: true }) + (p.soldOut ? '<span class="soldtag">Sold out</span>' : '') + '</div>' +
      '<div class="info"><p class="crumb"><a href="#/shop">Shop</a> / <a href="#/shop?type=' + p.type + '">' + U.esc(t.name) + '</a></p>' +
      '<h1>' + U.esc(p.name) + '</h1><p class="p-price">' + D.money(p.priceNaira) + '</p>' +
      '<div id="buy">' + buyHtml() + '</div>' +
      '<div class="acc">' +
      '<div><div class="acc-h"><span>Description</span><button type="button" class="linkbtn" id="more" aria-expanded="false" aria-controls="desc">Read more +</button></div><p class="copy clamp" id="desc">' + DESCRIPTION + '</p></div>' +
      '<details><summary>Material</summary><p class="copy">[Material: from Admin → Product. Sample text in brackets.]</p></details>' +
      '<details><summary>Delivery</summary>' + deliveryHtml() + '</details>' +
      '<details><summary>Returns</summary><p class="copy">[Returns: from the return policy in Admin. Sample text in brackets.]</p></details>' +
      '</div></div></div>' +
      (similar.length
        ? '<section class="similar"><div class="sechead"><h2 class="t-label">Similar outfits</h2><span class="muted" style="font-size:.8125rem">' + U.esc(t.name) + '</span></div>' +
          '<div class="carousel" role="region" aria-label="Similar outfits" tabindex="0"><ul class="track">' + similar.map(function (o) { return '<li>' + U.card(o, { quick: true }) + '</li>'; }).join('') + '</ul></div></section>'
        : '') +
      '</div>' +
      '<div class="sticky-bar" id="sticky"><span class="p">' + D.money(p.priceNaira) + '</span><button type="button" class="btn" id="add-sticky"' + (p.soldOut ? ' disabled' : '') + '>' + (p.soldOut ? 'Out of stock' : 'Add to cart') + '</button></div></div>';

    return {
      title: p.name,
      html: html,
      after: function (root) {
        document.body.classList.add('has-sticky', 'has-pdp');
        var buy = U.$('#buy', root);

        function redraw() { buy.innerHTML = buyHtml(); }
        function add(fromSticky) {
          var size = chosenSize();
          if (!size) {
            if (p.profile) { location.hash = '#/fit/' + p.slug; return; }
            if (fromSticky) { window.PROTO_SHEET.open(p.id, true); return; }
            return;
          }
          var qty = Math.min(state.qty, p.stock[size] || 1);
          var dec = decision();
          U.Cart.add(p.id, size, qty, p.profile ? dec.fit : 'direct');
          U.toast('Added to your cart.');
          U.openCart();
        }

        // listen on this page's own element: <main> lives on across routes and would collect listeners
        U.$('#pdp-scope', root).addEventListener('click', function (e) {
          var sz = e.target.closest('[data-size]');
          if (sz && !p.profile) { state.size = sz.dataset.size; redraw(); var again = U.$('[data-size="' + state.size + '"]', root); if (again) again.focus(); return; }
          var q = e.target.closest('[data-q]');
          if (q) { state.qty = Math.min(10, Math.max(1, state.qty + Number(q.dataset.q))); U.$('#qty', root).textContent = String(state.qty); return; }
          if (e.target.closest('#add')) { add(false); return; }
          if (e.target.closest('#add-sticky')) { add(true); return; }
          if (e.target.closest('#more')) {
            var d = U.$('#desc', root);
            var open = d.classList.toggle('open');
            var b = U.$('#more', root);
            b.setAttribute('aria-expanded', String(open));
            b.textContent = open ? 'Read less −' : 'Read more +';
          }
        });
        var track = U.$('.carousel', root);
        if (track) track.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * track.clientWidth * 0.6 }); }
        });
      },
    };
  }

  (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push(['/product/:slug', render]);
})();
