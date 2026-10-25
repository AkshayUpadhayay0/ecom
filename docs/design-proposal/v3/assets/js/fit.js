/* Find My Size (Blueprint): body measurements in inches -> fit preference -> recommendation with a
 * per-measurement breakdown and stock -> accept, or choose another size -> back to the outfit.
 * SAMPLE chart only (data.js). The fit preference is saved with the fitting and never changes the
 * size. A measurement above the chart has no size: a neutral message, nothing invented.
 * Also: the height and weight quick-start as a labelled CONCEPT (no calculation). */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;

  var PREFS = ['Tailored', 'Standard', 'Oversized'];
  var STEPS = ['Measurements', 'Fit preference', 'Your size'];
  var MAX_DECIMALS = 1;

  /* ---- validation (messages as in the built app) ---- */
  function validate(measure, raw) {
    var text = String(raw).trim().replace(',', '.');
    if (!text) return { error: 'Enter a measurement.' };
    if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Use numbers only, for example 42 or 42.5.' };
    if ((text.split('.')[1] || '').length > MAX_DECIMALS) return { error: 'Use at most one decimal place.' };
    var n = Number(text);
    if (n < measure.min) return { error: 'This looks too small. The smallest we accept is ' + measure.min + ' in.' };
    if (n > measure.max) return { error: 'This looks too large. The largest we accept is ' + measure.max + ' in.' };
    return { value: n };
  }

  /* ---- the engine: smallest size whose upper bound covers each measurement; the outfit's size is
   * the largest size any measurement needs; above the chart = no size ---- */
  function calc(profile, values) {
    var chart = D.CHART[profile];
    var rows = chart.measures.map(function (m) {
      var v = values[m.key];
      var size = null;
      for (var i = 0; i < chart.sizes.length; i += 1) {
        if (v <= m.bounds[chart.sizes[i]]) { size = chart.sizes[i]; break; }
      }
      var largest = chart.sizes[chart.sizes.length - 1];
      return { key: m.key, label: m.label, value: v, size: size, largestBound: m.bounds[largest] };
    });
    var outOfRange = rows.filter(function (r) { return r.size === null; });
    var overall = null;
    if (!outOfRange.length) {
      overall = rows.reduce(function (best, r) {
        return D.SIZE_ORDER.indexOf(r.size) > D.SIZE_ORDER.indexOf(best) ? r.size : best;
      }, rows[0].size);
    }
    return { rows: rows, overall: overall, outOfRange: outOfRange };
  }

  function gate(p) {
    return {
      title: 'Find my size',
      html:
        '<div class="wrap page"><div class="form-narrow"><h1 class="t-head">Find my size</h1>' +
        '<p style="margin:1rem 0 1.5rem">Sign in to find your size.</p>' +
        '<a class="btn" href="#/signin?next=' + encodeURIComponent('/fit/' + p.slug) + '">Sign in to continue</a></div></div>',
    };
  }

  function render(params, query) {
    var p = D.bySlug(params.slug);
    if (!p) return { title: 'Not found', html: '<div class="wrap page"><h1 class="t-head">Outfit not found</h1></div>' };
    if (!p.profile) {
      return {
        title: 'Find my size',
        html: '<div class="wrap page"><h1 class="t-head">Find my size</h1><p style="margin:1rem 0">This outfit has no Blueprint fit. Choose a size from the list.</p><a class="btn ghost" href="#/product/' + p.slug + '">Back to the outfit</a></div>',
      };
    }
    if (!D.state.signedIn) return gate(p);

    var chart = D.CHART[p.profile];
    var saved = D.state.fits[p.slug] || {};
    var flow = { step: 1, values: Object.assign({}, saved.measures || {}), pref: saved.pref || 'Standard', other: null, errors: {} };

    // demonstration shortcuts (guide links): out-of-range values, or small values that need a size the outfit is not made in
    if (query.demo === 'range') {
      chart.measures.forEach(function (m) { flow.values[m.key] = String(m.bounds[chart.sizes[chart.sizes.length - 1]] + 6); });
      flow.step = 3;
    } else if (query.demo === 'small') {
      chart.measures.forEach(function (m) { flow.values[m.key] = String(m.bounds[chart.sizes[0]] - 1); });
      flow.step = 3;
    }

    var t = D.typeOf(p.type);

    function stepper() {
      return '<ol class="steps" aria-label="Steps">' + STEPS.map(function (s, i) {
        var n = i + 1;
        var cls = n < flow.step ? ' class="done"' : '';
        return '<li' + (n === flow.step ? ' aria-current="step"' : cls) + '><span class="sr-only">' + (n < flow.step ? 'Done: ' : n === flow.step ? 'Current step: ' : 'Next: ') + '</span>' + n + '. ' + s + '</li>';
      }).join('') + '</ol>';
    }

    function stepMeasurements() {
      var fields = chart.measures.map(function (m) {
        var err = flow.errors[m.key];
        var id = 'm-' + m.key;
        return (
          '<div class="field"><label for="' + id + '">' + m.label + '</label><div class="input-unit">' +
          '<input class="input" id="' + id + '" name="' + m.key + '" inputmode="decimal" autocomplete="off" value="' + U.esc(flow.values[m.key] || '') + '"' +
          (err ? ' aria-invalid="true" aria-describedby="' + id + '-e"' : '') + '><span aria-hidden="true">in</span></div>' +
          (err ? '<p class="err" id="' + id + '-e">' + err + '</p>' : '') + '</div>'
        );
      }).join('');
      return (
        '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">Your measurements</h2>' +
        '<p style="margin:.75rem 0 1.25rem;font-family:var(--body)">Enter your body measurements in inches. We match them to our size chart to recommend your size.</p>' +
        '<form id="mform" novalidate><div class="mgrid">' + fields + '</div>' +
        '<p class="helper" style="margin:0 0 .5rem">Use up to one decimal place, for example 42.5.</p>' +
        '<p class="shortcut">Prototype shortcut: <button type="button" id="sample">Fill in sample measurements</button> · <a href="#/fit-concept">Height and weight quick-start (concept)</a></p>' +
        '<div class="actions"><button type="submit" class="btn">Continue</button><a class="btn ghost" href="#/product/' + p.slug + '">Cancel</a></div></form>'
      );
    }

    function stepPref() {
      return (
        '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">Fit preference</h2>' +
        '<form id="pform"><fieldset class="prefs" style="margin-top:1.25rem"><legend class="sr-only">Fit preference</legend>' +
        PREFS.map(function (name) {
          return '<label class="pref"><input type="radio" name="pref" value="' + name + '"' + (flow.pref === name ? ' checked' : '') + '><b>' + name + '</b></label>';
        }).join('') + '</fieldset>' +
        '<p class="helper" style="margin-top:1rem">Your fit preference is saved with your measurements. It does not change the size we recommend.</p>' +
        '<div class="actions"><button type="submit" class="btn">See my size</button><button type="button" class="btn ghost" id="back">Change measurements</button></div></form>'
      );
    }

    function chips(sel, recommended) {
      return p.sizes.map(function (sz) {
        var st = D.stockState(p, sz);
        return '<button type="button" class="size" role="radio" data-other="' + sz + '" aria-checked="' + (sel === sz) + '"' + (st === 'out' ? ' disabled' : '') + '><span class="sr-only">Size </span><b>' + sz + '</b><small>' + (sz === recommended ? 'Recommended' : st === 'in' ? '' : D.STOCK_TEXT[st]) + '</small></button>';
      }).join('');
    }

    function stepResult() {
      var values = {};
      chart.measures.forEach(function (m) { values[m.key] = Number(String(flow.values[m.key]).replace(',', '.')); });
      var r = calc(p.profile, values);
      if (r.outOfRange.length) {
        return (
          '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">We could not match this measurement to our size chart.</h2>' +
          '<ul style="margin:1rem 0;font-family:var(--body)">' + r.outOfRange.map(function (x) {
            return '<li>' + x.label + ': ' + x.value + ' in is above the largest size on our chart (' + x.largestBound + ' in).</li>';
          }).join('') + '</ul>' +
          '<p class="note" role="status">You can contact us for help: [support contact: supplied by the client]</p>' +
          '<div class="actions"><button type="button" class="btn" id="back">Change measurements</button><a class="btn ghost" href="#/product/' + p.slug + '">Back to the outfit</a></div>'
        );
      }
      var rec = r.overall;
      var offered = p.sizes.indexOf(rec) >= 0;
      var st = offered ? D.stockState(p, rec) : null;
      var rows = r.rows.map(function (x) {
        var decides = x.size === rec;
        return '<tr' + (decides ? ' class="decides"' : '') + '><td>' + x.label + '</td><td>' + x.value + ' in</td><td>' + x.size + (decides ? '<span class="tag-decides">decides</span>' : '') + '</td></tr>';
      }).join('');
      var warn = !offered
        ? '<p class="note" role="status" style="margin-bottom:1rem">This outfit is not made in size ' + rec + '. Please choose one of the sizes below.</p>'
        : st === 'out'
          ? '<p class="note" role="status" style="margin-bottom:1rem">Size ' + rec + ' is out of stock right now. You can keep it as your size; checkout opens once it is back in stock.</p>'
          : '';
      return (
        '<h2 class="t-head" id="step-h" tabindex="-1" style="font-size:1.75rem">Your recommended size</h2>' +
        '<p class="result-size" data-testid="recommended-size"><span class="sr-only">Size </span>' + rec + '</p>' +
        (offered ? '<p class="status-' + st + '" style="font-weight:600" data-testid="stock">' + D.STOCK_TEXT[st] + '</p>' : '') + warn +
        '<h3 style="font-size:1rem;margin-top:1.25rem">How we matched your measurements</h3>' +
        '<table class="break"><thead><tr><th scope="col">Measurement</th><th scope="col">Your value</th><th scope="col">Size needed</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<p class="helper">Your size is the largest size that any of your measurements needs.</p>' +
        '<p class="helper" style="margin-top:.4rem">Fit preference saved with your measurements: <b>' + flow.pref + '</b>. It does not change the size.</p>' +
        '<div class="actions"><button type="button" class="btn" id="accept"' + (offered ? '' : ' disabled') + '>Use size ' + rec + '</button><button type="button" class="btn ghost" id="back">Change measurements</button></div>' +
        '<section class="other" aria-labelledby="other-h"><h3 id="other-h">Prefer a different size?</h3>' +
        '<p>You can choose any size this outfit is made in. We save your choice together with your measurements.</p>' +
        '<div class="sizes" role="radiogroup" aria-label="Choose a size">' + chips(flow.other, rec) + '</div>' +
        '<div class="actions"><button type="button" class="btn ghost" id="other-use"' + (flow.other ? '' : ' disabled') + '>' + (flow.other ? 'Use size ' + flow.other + ' instead' : 'Use another size') + '</button></div></section>'
      );
    }

    function body() {
      return stepper() + (flow.step === 1 ? stepMeasurements() : flow.step === 2 ? stepPref() : stepResult());
    }

    var html =
      '<div class="wrap page"><div class="fit"><div class="side">' + U.vframe('fit-intro', { ratio: '4/5' }) +
      '<p><b>' + U.esc(p.name) + '</b> · ' + U.esc(t.name) + '<br>' + D.money(p.priceNaira) + '</p>' +
      '<p>' + U.esc(D.CHART.note) + '</p></div>' +
      '<div class="main"><p class="crumb"><a href="#/product/' + p.slug + '">← ' + U.esc(p.name) + '</a></p>' +
      '<h1 class="t-head">Find my size</h1><div id="flow">' + body() + '</div></div></div></div>';

    return {
      title: 'Find my size',
      html: html,
      after: function (root) {
        var host = U.$('#flow', root);
        function show(focus) {
          host.innerHTML = body();
          wire();
          var h = U.$('#step-h', host);
          if (focus && h) h.focus();
          U.$('#live').textContent = STEPS[flow.step - 1];
        }
        function wire() {
          var mform = U.$('#mform', host);
          if (mform) {
            mform.addEventListener('submit', function (e) {
              e.preventDefault();
              flow.errors = {};
              var firstBad = null;
              chart.measures.forEach(function (m) {
                var raw = U.$('[name="' + m.key + '"]', mform).value; // not form.elements: elements.length is the count
                flow.values[m.key] = raw;
                var res = validate(m, raw);
                if (res.error) { flow.errors[m.key] = res.error; if (!firstBad) firstBad = m.key; }
              });
              if (firstBad) { show(false); U.$('#m-' + firstBad, host).focus(); return; }
              flow.step = 2;
              show(true);
            });
            U.$('#sample', host).addEventListener('click', function () {
              chart.measures.forEach(function (m) { U.$('[name="' + m.key + '"]', mform).value = chart.sample[m.key]; flow.values[m.key] = chart.sample[m.key]; });
            });
          }
          var pform = U.$('#pform', host);
          if (pform) {
            pform.addEventListener('submit', function (e) {
              e.preventDefault();
              flow.pref = pform.elements.pref.value;
              flow.step = 3;
              flow.other = null;
              show(true);
            });
          }
          var back = U.$('#back', host);
          if (back) back.addEventListener('click', function () { flow.step = flow.step === 3 ? 1 : 1; flow.errors = {}; show(true); });
          var accept = U.$('#accept', host);
          if (accept) accept.addEventListener('click', function () { save(false); });
          var useOther = U.$('#other-use', host);
          if (useOther) useOther.addEventListener('click', function () { save(true); });
          U.$$('[data-other]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              flow.other = b.dataset.other;
              show(false);
              U.$('[data-other="' + flow.other + '"]', host).focus();
            });
          });
        }
        function save(chose) {
          var values = {};
          chart.measures.forEach(function (m) { values[m.key] = Number(String(flow.values[m.key]).replace(',', '.')); });
          var rec = calc(p.profile, values).overall;
          D.state.fits[p.slug] = {
            size: chose ? flow.other : rec, fit: chose && flow.other !== rec ? 'choice' : 'recommended', recommended: rec,
            pref: flow.pref, measures: flow.values,
          };
          D.save();
          U.toast('Your size is saved.');
          location.hash = '#/product/' + p.slug;
        }
        wire();
      },
    };
  }

  /* ---- CONCEPT: height and weight quick-start (no calculation) ---- */
  function concept() {
    return {
      title: 'Height and weight (concept)',
      html:
        '<div class="wrap page"><div class="form-narrow" style="max-width:36rem">' +
        '<div class="banner" role="note"><b>CONCEPT</b><span>Pending client decision: needs brand sizing rules.</span></div>' +
        '<h1 class="t-head">Quick start with height and weight</h1>' +
        '<p style="margin:1rem 0 1.5rem;font-family:var(--body)">A shorter way into Find my size, shown only so the idea can be reviewed. No size is calculated here: a height and weight start needs the brand’s own sizing rules, which have not been supplied, so the button stays off.</p>' +
        '<form class="concept-form" onsubmit="return false" novalidate>' +
        '<div class="field"><label for="c-h">Height</label><div class="input-unit"><input class="input" id="c-h" inputmode="decimal" autocomplete="off"><span aria-hidden="true">cm</span></div></div>' +
        '<div class="field"><label for="c-w">Weight</label><div class="input-unit"><input class="input" id="c-w" inputmode="decimal" autocomplete="off"><span aria-hidden="true">kg</span></div></div>' +
        '<fieldset class="prefs" style="margin-bottom:1.25rem"><legend class="sr-only">Fit preference</legend>' +
        PREFS.map(function (n, i) { return '<label class="pref"><input type="radio" name="cp"' + (i === 1 ? ' checked' : '') + '><b>' + n + '</b></label>'; }).join('') + '</fieldset>' +
        '<button type="button" class="btn full" aria-disabled="true" disabled>Continue</button>' +
        '<p class="helper" style="margin-top:.75rem">Continue is off: no sizing rules, no calculation.</p></form>' +
        '<p style="margin-top:1.75rem"><a class="link" href="#/fit/sample-outfit-03">Use body measurements instead (Find my size)</a></p></div></div>',
    };
  }

  (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push(['/fit/:slug', render], ['/fit-concept', concept]);
})();
