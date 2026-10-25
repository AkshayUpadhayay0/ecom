/* Cart page, checkout (account -> delivery -> review -> payment), confirmation, failed payment, My orders.
 * SIMULATED: no card fields, no real payment page. The "Secure payment with Paystack" step is a neutral
 * screen (no Paystack branding or form) with a clearly labelled Prototype switch for success or failure.
 * What is typed in the delivery form is kept in memory only (never stored, gone on reload or reset). */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;

  var CK = { details: null, outcome: 'success', paying: false };
  var PAY_DELAY_MS = 1200;
  var STEPS = ['Account', 'Delivery', 'Review', 'Payment'];
  var offCart = null;

  function zone(code) {
    return D.ZONES.filter(function (z) { return z.code === code; })[0] || null;
  }
  function subtotal(lines) {
    return lines.reduce(function (n, l) { return n + D.byId(l.product).priceNaira * l.qty; }, 0);
  }
  function blocked() {
    return D.state.cart.some(function (l) { return U.lineIssue(l); });
  }
  function onCartChange(fn) {
    if (offCart) document.removeEventListener('proto:cart', offCart);
    offCart = fn;
    if (fn) document.addEventListener('proto:cart', fn);
  }
  function go(hash) { location.hash = hash; }

  function field(id, label, opts) {
    opts = opts || {};
    var err = opts.error;
    var tag = opts.area ? 'textarea' : 'input';
    return (
      '<div class="field"><label for="' + id + '">' + label + (opts.optional ? ' <span class="muted" style="font-weight:400">(optional)</span>' : '') + '</label>' +
      '<' + tag + ' class="input" id="' + id + '" name="' + id + '"' + (opts.area ? ' rows="3"' : ' type="text"') + ' autocomplete="off" placeholder="' + U.esc(opts.placeholder || '') + '"' +
      (err ? ' aria-invalid="true" aria-describedby="' + id + '-e"' : '') + (opts.area ? '>' + U.esc(opts.value || '') + '</textarea>' : ' value="' + U.esc(opts.value || '') + '">') +
      (err ? '<p class="err" id="' + id + '-e">' + err + '</p>' : '') + '</div>'
    );
  }

  /* ---------- summary ---------- */
  function summaryHtml(zoneCode) {
    var lines = D.state.cart;
    var z = zone(zoneCode);
    var sub = subtotal(lines);
    return (
      '<aside class="co-sum" aria-labelledby="sum-h"><h2 id="sum-h">Order summary</h2><ul class="sum-lines">' +
      lines.map(function (l) {
        var p = D.byId(l.product);
        return '<li><span>' + U.esc(p.name) + '<small>Size ' + U.esc(l.size) + ' · Quantity ' + l.qty + '</small></span><span class="price">' + D.money(p.priceNaira * l.qty) + '</span></li>';
      }).join('') + '</ul>' +
      '<dl class="sum-rows"><div><dt>Subtotal</dt><dd class="price">' + D.money(sub) + '</dd></div>' +
      '<div><dt>Delivery</dt><dd class="price">' + (z ? D.money(z.feeNaira) : 'Choose a zone') + '</dd></div>' +
      '<div class="total"><dt>Total</dt><dd class="price" data-testid="total">' + (z ? D.money(sub + z.feeNaira) : D.money(sub)) + '</dd></div></dl>' +
      (z ? '' : '<p class="helper">The delivery charge is added once you choose a zone.</p>') + '</aside>'
    );
  }

  function checkoutShell(step, main, zoneCode) {
    return (
      '<div class="wrap page"><h1 class="t-head">Checkout</h1>' +
      '<ol class="steps" aria-label="Checkout steps">' + STEPS.map(function (s, i) {
        var n = i + 1;
        return '<li' + (n === step ? ' aria-current="step"' : n < step ? ' class="done"' : '') + '><span class="sr-only">' + (n < step ? 'Done: ' : n === step ? 'Current step: ' : 'Next: ') + '</span>' + n + '. ' + s + '</li>';
      }).join('') + '</ol>' +
      '<div class="co"><div class="co-main">' + main + '</div>' + summaryHtml(zoneCode) + '</div></div>'
    );
  }

  /* ---------- cart ---------- */
  function cart(_p, query) {
    if (query.demo === 'stock') {
      D.state.cart = [{ product: 'p01', size: 'M', qty: 1, fit: 'recommended' }, { product: 'p10', size: 'XL', qty: 3, fit: 'choice' }];
      D.save();
      U.Cart.refresh();
    }
    function body() {
      var lines = D.state.cart;
      if (!lines.length) {
        return '<h1 class="t-head">Your cart</h1><p class="empty" role="status">Your cart is empty.</p><a class="btn ghost" href="#/shop">Continue shopping</a>';
      }
      var bad = blocked();
      return (
        '<h1 class="t-head">Your cart</h1><p class="muted" style="margin:.5rem 0 1.5rem;font-family:var(--body)">Review your sizes before you continue.</p>' +
        '<div class="co"><div class="co-main"><ul class="cart-lines">' + lines.map(function (l, i) { return U.lineHtml(l, i, true, { refit: true, unit: true, issue: true }); }).join('') + '</ul></div>' +
        '<aside class="co-sum" aria-labelledby="sum-h"><h2 id="sum-h">Summary</h2><dl class="sum-rows"><div><dt>Subtotal</dt><dd class="price" data-testid="subtotal">' + D.money(subtotal(lines)) + '</dd></div></dl>' +
        '<p class="helper">Delivery is added at checkout.</p>' +
        (bad
          ? '<button type="button" class="btn full" disabled>Checkout</button><p class="err" role="status" style="margin-top:.75rem">Fix the items marked above to continue.</p>'
          : '<a class="btn full" href="#/checkout" id="checkout">Checkout</a>') +
        '<p style="margin-top:1rem;text-align:center"><a class="link" href="#/shop">Continue shopping</a></p></aside></div>'
      );
    }
    return {
      title: 'Your cart',
      html: '<div class="wrap page" id="cartpage">' + body() + '</div>',
      after: function (root) {
        onCartChange(function () {
          var host = U.$('#cartpage', root);
          if (host) { host.innerHTML = body(); window.PROTO_VIDEO.mount(host); }
        });
      },
    };
  }

  /* ---------- checkout ---------- */
  function guard() {
    if (!D.state.cart.length) return { title: 'Checkout', html: '<div class="wrap page"><h1 class="t-head">Checkout</h1><p class="empty" role="status">Your cart is empty.</p><a class="btn ghost" href="#/shop">Continue shopping</a></div>' };
    if (blocked()) { go('#/cart'); return { title: 'Your cart', html: '' }; }
    return null;
  }

  function account() {
    var g = guard();
    if (g) return g;
    if (D.state.signedIn) { go('#/checkout/delivery'); return { title: 'Checkout', html: '' }; }
    return {
      title: 'Checkout: account',
      html: checkoutShell(1,
        '<h2 class="t-head" style="font-size:1.75rem">Sign in or create an account</h2>' +
        '<p style="margin:.75rem 0 1.5rem;font-family:var(--body)">Your orders belong to your account, so we ask you to sign in before you pay.</p>' +
        '<div class="actions"><a class="btn" href="#/signin?next=%2Fcheckout">Sign in</a><a class="btn ghost" href="#/register?next=%2Fcheckout">Create an account</a></div>' +
        '<p class="shortcut">Prototype: sign-in is simulated and nothing you type is stored.</p>', null),
    };
  }

  function delivery() {
    var g = guard();
    if (g) return g;
    if (!D.state.signedIn) { go('#/checkout'); return { title: 'Checkout', html: '' }; }
    var d = CK.details || {};
    var zoneCode = D.state.checkout.zone || '';
    var errors = {};

    function formHtml() {
      return (
        '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">Delivery details</h2>' +
        '<p class="note" style="margin:1rem 0 1.25rem">Prototype: use the sample details. What you type is kept in this tab only and is never stored or sent.</p>' +
        '<form id="dform" novalidate><div class="mgrid">' +
        field('d-name', 'Full name', { placeholder: '[Full name]', value: d.name, error: errors.name }) +
        field('d-phone', 'Phone number', { placeholder: '[Phone number]', value: d.phone, error: errors.phone }) + '</div>' +
        field('d-address', 'Address', { placeholder: '[Street and number]', value: d.address, error: errors.address }) +
        field('d-area', 'Area', { placeholder: '[Area]', value: d.area, error: errors.area }) +
        '<div class="field"><label for="d-zone">Delivery zone</label><select class="select input" id="d-zone" name="d-zone"' + (errors.zone ? ' aria-invalid="true" aria-describedby="d-zone-e"' : '') + '>' +
        '<option value="">Choose a zone</option>' +
        D.ZONES.map(function (z) { return '<option value="' + z.code + '"' + (zoneCode === z.code ? ' selected' : '') + '>' + U.esc(z.name) + ' — ' + D.money(z.feeNaira) + ' · ' + z.days + '</option>'; }).join('') +
        '</select>' + (errors.zone ? '<p class="err" id="d-zone-e">' + errors.zone + '</p>' : '') + '<p class="hint">Delivery fees and areas are sample figures.</p></div>' +
        field('d-notes', 'Delivery notes', { optional: true, area: true, placeholder: '[Delivery notes]', value: d.notes }) +
        '<p class="shortcut"><button type="button" id="sample">Fill in sample details</button></p>' +
        '<div class="actions"><button type="submit" class="btn">Continue to review</button><a class="btn ghost" href="#/cart">Back to cart</a></div></form>'
      );
    }
    return {
      title: 'Checkout: delivery',
      html: '<div id="co-root">' + checkoutShell(2, formHtml(), zoneCode) + '</div>',
      after: function (root) {
        var host = U.$('#co-root', root);
        function draw(focusFirst) {
          host.innerHTML = checkoutShell(2, formHtml(), zoneCode);
          wire();
          if (focusFirst) { var bad = U.$('[aria-invalid=true]', host); if (bad) bad.focus(); }
        }
        function read(form) {
          d = {
            name: form.elements['d-name'].value.trim(), phone: form.elements['d-phone'].value.trim(),
            address: form.elements['d-address'].value.trim(), area: form.elements['d-area'].value.trim(),
            notes: form.elements['d-notes'].value.trim(),
          };
          zoneCode = form.elements['d-zone'].value;
        }
        function wire() {
          var form = U.$('#dform', host);
          U.$('#d-zone', host).addEventListener('change', function (e) {
            read(form);
            D.state.checkout.zone = zoneCode;
            D.save();
            errors = {};
            draw(false);
            U.$('#d-zone', host).focus();
          });
          U.$('#sample', host).addEventListener('click', function () {
            d = { name: '[Sample name]', phone: '[0800 000 0000]', address: '[Sample street and number]', area: '[Sample area]', notes: d.notes || '' };
            if (!zoneCode) zoneCode = D.ZONES[0].code;
            D.state.checkout.zone = zoneCode;
            D.save();
            errors = {};
            draw(false);
          });
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            read(form);
            errors = {};
            if (!d.name) errors.name = 'This field is required.';
            if (d.phone.replace(/\D/g, '').length < 7) errors.phone = d.phone ? 'Enter a valid phone number.' : 'This field is required.';
            if (!d.address) errors.address = 'This field is required.';
            if (!d.area) errors.area = 'This field is required.';
            if (!zoneCode) errors.zone = 'Choose a delivery zone.';
            if (Object.keys(errors).length) { draw(true); return; }
            CK.details = d;
            D.state.checkout.zone = zoneCode;
            D.save();
            go('#/checkout/review');
          });
        }
        wire();
      },
    };
  }

  function review() {
    var g = guard();
    if (g) return g;
    if (!D.state.signedIn) { go('#/checkout'); return { title: 'Checkout', html: '' }; }
    var z = zone(D.state.checkout.zone);
    if (!CK.details || !z) { go('#/checkout/delivery'); return { title: 'Checkout', html: '' }; }
    var d = CK.details;
    return {
      title: 'Checkout: review',
      html: checkoutShell(3,
        '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">Review your order</h2>' +
        '<section class="block"><h2>Items</h2><ul class="cart-lines">' + D.state.cart.map(function (l, i) { return U.lineHtml(l, i, false, { unit: true }); }).join('') + '</ul></section>' +
        '<section class="block"><h2>Delivery <a class="link" style="font-weight:400;letter-spacing:0;text-transform:none" href="#/checkout/delivery">Change</a></h2>' +
        '<address style="font-style:normal;font-family:var(--body);line-height:1.6">' + U.esc(d.name) + '<br>' + U.esc(d.address) + '<br>' + U.esc(d.area) + '<br>' + U.esc(d.phone) + (d.notes ? '<br><span class="muted">' + U.esc(d.notes) + '</span>' : '') + '</address>' +
        '<p style="margin-top:.6rem">' + U.esc(z.name) + ' · ' + D.money(z.feeNaira) + ' · ' + z.days + '</p></section>' +
        '<div class="actions"><a class="btn" href="#/checkout/pay" id="to-pay">Continue to secure payment</a><a class="btn ghost" href="#/cart">Back to cart</a></div>',
        z.code),
    };
  }

  function pay() {
    var g = guard();
    if (g) return g;
    var z = zone(D.state.checkout.zone);
    if (!D.state.signedIn || !CK.details || !z) { go('#/checkout'); return { title: 'Checkout', html: '' }; }
    var total = subtotal(D.state.cart) + z.feeNaira;
    return {
      title: 'Checkout: payment',
      html: checkoutShell(4,
        '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">Secure payment with Paystack</h2>' +
        '<p style="margin:.75rem 0 1.25rem;font-family:var(--body);max-width:40rem">You pay on Paystack’s own secure page, so we never see or store your card details. This prototype does not copy that page: it only shows what happens next.</p>' +
        '<p class="due">Amount to pay <b class="price" data-testid="due">' + D.money(total) + '</b></p>' +
        '<fieldset class="proto-switch"><legend><span class="proto-tag">Prototype</span> Choose what happens</legend>' +
        '<label><input type="radio" name="outcome" value="success"' + (CK.outcome === 'success' ? ' checked' : '') + '> Payment succeeds</label>' +
        '<label><input type="radio" name="outcome" value="failure"' + (CK.outcome === 'failure' ? ' checked' : '') + '> Payment fails</label></fieldset>' +
        '<div class="actions"><button type="button" class="btn" id="pay">Pay ' + D.money(total) + '</button><a class="btn ghost" href="#/checkout/review">Back to review</a></div>' +
        '<p id="paying" class="helper" role="status" style="margin-top:1rem"></p>', z.code),
      after: function (root) {
        U.$$('[name=outcome]', root).forEach(function (r) { r.addEventListener('change', function () { CK.outcome = r.value; }); });
        U.$('#pay', root).addEventListener('click', function () {
          if (CK.paying) return;
          CK.paying = true;
          var btn = U.$('#pay', root);
          btn.disabled = true;
          U.$('#paying', root).innerHTML = '<span class="spinner" aria-hidden="true"></span> Confirming your payment…';
          window.setTimeout(function () {
            CK.paying = false;
            if (CK.outcome === 'failure') { go('#/checkout/failed'); return; }
            placeOrder(z, total);
          }, PAY_DELAY_MS);
        });
      },
    };
  }

  function nextOrderId() {
    var n = 5 + D.state.orders.length;
    return 'UI-[' + (n < 1000 ? ('000' + n).slice(-4) : n) + ']';
  }
  function placeOrder(z) {
    var order = {
      id: nextOrderId(), status: 0, zone: z.code,
      lines: D.state.cart.map(function (l) { return { product: l.product, size: l.size, qty: l.qty, fit: l.fit, price: D.byId(l.product).priceNaira }; }),
    };
    D.state.orders.unshift(order);
    D.state.cart = [];
    CK.details = null;
    D.save();
    U.Cart.refresh();
    go('#/checkout/done?order=' + encodeURIComponent(order.id));
  }

  function failed() {
    return {
      title: 'Payment not completed',
      html:
        '<div class="wrap page"><div class="form-narrow" style="max-width:36rem"><h1 class="t-head" id="step-h" tabindex="-1">Your payment was not completed</h1>' +
        '<p role="status" style="margin:1rem 0;font-family:var(--body)">Nothing was charged and your cart is unchanged. You can try again.</p>' +
        '<p class="note" style="margin-bottom:1.5rem">You can contact us for help: [support contact: supplied by the client]</p>' +
        '<div class="actions"><a class="btn" href="#/checkout/pay" id="retry">Try again</a><a class="btn ghost" href="#/checkout/review">Back to review</a></div></div></div>',
    };
  }

  /* ---------- orders ---------- */
  function allOrders() {
    return D.state.orders.map(function (o) { return { o: o, mine: true }; })
      .concat(D.SEED_ORDERS.map(function (s) {
        return { mine: false, o: { id: s.id, status: s.status, zone: s.zone, lines: s.lines.map(function (l) { return { product: l.product, size: l.size, qty: l.qty, price: D.byId(l.product).priceNaira }; }) } };
      }));
  }
  function orderTotal(o) {
    var z = zone(o.zone);
    return o.lines.reduce(function (n, l) { return n + l.price * l.qty; }, 0) + (z ? z.feeNaira : 0);
  }
  function timeline(o) {
    return '<ol class="timeline" aria-label="Order status">' + D.STATUSES.map(function (s, i) {
      var cls = i < o.status ? 'done' : i === o.status ? 'now' : '';
      var hint = i < o.status ? 'Done: ' : i === o.status ? 'Current: ' : 'Next: ';
      return '<li class="' + cls + '"' + (i === o.status ? ' aria-current="step"' : '') + '><span class="dot" aria-hidden="true"></span><span class="sr-only">' + hint + '</span>' + s + '</li>';
    }).join('') + '</ol>';
  }
  function orderHtml(entry) {
    var o = entry.o;
    var z = zone(o.zone);
    return (
      '<article class="order" aria-labelledby="o-' + U.esc(o.id.replace(/\W/g, '')) + '"><header><h2 id="o-' + U.esc(o.id.replace(/\W/g, '')) + '">Order ' + U.esc(o.id) + '</h2>' +
      '<span class="muted">Placed [date]</span><span class="price" style="margin-left:auto;font-weight:700">' + D.money(orderTotal(o)) + '</span></header>' +
      timeline(o) +
      '<ul class="order-lines">' + o.lines.map(function (l) {
        var p = D.byId(l.product);
        return '<li><img src="media/poster/' + p.media + '.webp" alt="" width="48" height="60"><span>' + U.esc(p.name) + '<small>Size ' + U.esc(l.size) + ' · Quantity ' + l.qty + '</small></span><span class="price">' + D.money(l.price * l.qty) + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="muted" style="font-size:.875rem">Delivery: ' + (z ? U.esc(z.name) + ' · ' + D.money(z.feeNaira) : '') + '</p>' +
      (entry.mine && o.status < D.STATUSES.length - 1 ? '<p class="shortcut">Prototype control: <button type="button" data-advance="' + U.esc(o.id) + '">Move this order to the next status</button></p>' : '') +
      '</article>'
    );
  }

  function orders() {
    if (!D.state.signedIn) {
      return { title: 'My orders', html: '<div class="wrap page"><h1 class="t-head">My orders</h1><p style="margin:1rem 0">Sign in to see your orders.</p><a class="btn" href="#/signin?next=%2Forders">Sign in</a></div>' };
    }
    function body() {
      var list = allOrders();
      return list.length
        ? list.map(orderHtml).join('')
        : '<p class="empty" role="status">You have no orders yet.</p><a class="btn ghost" href="#/shop">Continue shopping</a>';
    }
    return {
      title: 'My orders',
      html: '<div class="wrap page" id="orders-page"><h1 class="t-head" style="margin-bottom:1.5rem">My orders</h1><div id="olist">' + body() + '</div></div>',
      after: function (root) {
        U.$('#orders-page', root).addEventListener('click', function (e) {
          var b = e.target.closest('[data-advance]');
          if (!b) return;
          var o = D.state.orders.filter(function (x) { return x.id === b.dataset.advance; })[0];
          if (o && o.status < D.STATUSES.length - 1) o.status += 1;
          D.save();
          U.$('#olist', root).innerHTML = body();
          U.$('#live').textContent = 'Order status: ' + D.STATUSES[o ? o.status : 0];
        });
      },
    };
  }

  function done(_p, query) {
    var o = D.state.orders.filter(function (x) { return x.id === query.order; })[0];
    if (!o) { go('#/'); return { title: 'Home', html: '' }; }
    var z = zone(o.zone);
    return {
      title: 'Order confirmed',
      html:
        '<div class="wrap page"><div class="form-narrow" style="max-width:40rem"><p class="t-label muted">Payment received</p>' +
        '<h1 class="t-head" id="step-h" tabindex="-1" style="margin:.5rem 0 1rem">Thank you. Your order is confirmed.</h1>' +
        '<p style="font-size:1.25rem" data-testid="order-id">Order ' + U.esc(o.id) + '</p>' +
        '<div class="status-now" role="status">Status: <b>' + D.STATUSES[o.status] + '</b></div>' +
        '<ul class="order-lines" style="margin-top:1.25rem">' + o.lines.map(function (l) {
          var p = D.byId(l.product);
          return '<li><img src="media/poster/' + p.media + '.webp" alt="" width="48" height="60"><span>' + U.esc(p.name) + '<small>Size ' + U.esc(l.size) + ' · Quantity ' + l.qty + '</small></span><span class="price">' + D.money(l.price * l.qty) + '</span></li>';
        }).join('') + '</ul>' +
        '<dl class="sum-rows" style="margin-top:1rem"><div><dt>Delivery</dt><dd class="price">' + (z ? D.money(z.feeNaira) : '') + '</dd></div><div class="total"><dt>Total paid</dt><dd class="price">' + D.money(orderTotal(o)) + '</dd></div></dl>' +
        '<p class="helper" style="margin-top:.75rem">' + (z ? U.esc(z.name) + ' · ' + z.days : '') + '. In the real site a confirmation email is sent; this prototype sends nothing.</p>' +
        '<div class="actions"><a class="btn" href="#/orders">View my orders</a><a class="btn ghost" href="#/shop">Continue shopping</a></div></div></div>',
    };
  }

  document.addEventListener('proto:route', function () { onCartChange(null); });
  document.addEventListener('proto:reset', function () { CK.details = null; CK.outcome = 'success'; CK.paying = false; });

  (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push(
    ['/cart', cart], ['/checkout', account], ['/checkout/delivery', delivery], ['/checkout/review', review],
    ['/checkout/pay', pay], ['/checkout/failed', failed], ['/checkout/done', done], ['/orders', orders]
  );
})();
