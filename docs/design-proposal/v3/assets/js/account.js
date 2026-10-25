/* Sign in, register and account. SIMULATED: any valid-looking entry signs you in as a sample
 * customer. What is typed is never stored or sent; only a "signed in" flag lives in sessionStorage. */
(function () {
  'use strict';
  var D = window.PROTO;
  var U = window.PROTO_UI;
  var PASSWORD_MIN = 10;

  function field(id, label, opts) {
    opts = opts || {};
    var err = opts.error;
    return (
      '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input class="input" id="' + id + '" name="' + id + '" type="' + (opts.type || 'text') + '" autocomplete="off"' + (err ? ' aria-invalid="true" aria-describedby="' + id + '-e"' : '') + '>' +
      (opts.hint ? '<p class="hint">' + opts.hint + '</p>' : '') +
      (err ? '<p class="err" id="' + id + '-e">' + err + '</p>' : '') + '</div>'
    );
  }

  function nextTarget(query) {
    var n = query.next || '';
    return /^\/[a-z]/i.test(n) && n.indexOf('//') < 0 ? '#' + n : '#/account';
  }

  function signIn(query, why) {
    D.state.signedIn = true;
    D.save();
    U.syncAccount();
    U.toast(why);
    location.hash = nextTarget(query);
  }

  function sign(_p, query) {
    var next = query.next ? '?next=' + encodeURIComponent(query.next) : '';
    return {
      title: 'Sign in',
      html:
        '<div class="wrap page"><div class="form-narrow"><h1 class="t-head">Sign in</h1>' +
        '<p class="note" style="margin:1rem 0 1.5rem">Prototype: any email and password signs you in as a sample customer. Nothing you type is stored.</p>' +
        (query.next ? '<p style="margin-bottom:1rem">Please sign in to continue.</p>' : '') +
        '<form id="f" novalidate>' + field('email', 'Email', { type: 'email' }) + field('password', 'Password', { type: 'password' }) +
        '<button class="btn full" type="submit">Sign in</button></form>' +
        '<p style="margin-top:1.5rem">New here? <a class="link" href="#/register' + next + '">Create an account</a></p></div></div>',
      after: function (root) {
        var f = U.$('#f', root);
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var errors = {};
          if (!/^\S+@\S+\.\S+$/.test(f.elements.email.value.trim())) errors.email = 'Enter a valid email address.';
          if (!f.elements.password.value) errors.password = 'This field is required.';
          if (errors.email || errors.password) {
            f.innerHTML = field('email', 'Email', { type: 'email', error: errors.email }) + field('password', 'Password', { type: 'password', error: errors.password }) + '<button class="btn full" type="submit">Sign in</button>';
            var bad = U.$('[aria-invalid=true]', f);
            if (bad) bad.focus();
            return;
          }
          signIn(query, 'Signed in as a sample customer.');
        });
      },
    };
  }

  function register(_p, query) {
    var next = query.next ? '?next=' + encodeURIComponent(query.next) : '';
    function formHtml(e) {
      e = e || {};
      return (
        field('name', 'Full name', { error: e.name }) + field('email', 'Email', { type: 'email', error: e.email }) +
        field('password', 'Password', { type: 'password', hint: 'Use at least ' + PASSWORD_MIN + ' characters. Very common passwords are not accepted.', error: e.password }) +
        '<div class="checkrow"><input type="checkbox" id="terms" name="terms"' + (e.terms ? ' aria-invalid="true" aria-describedby="terms-e"' : '') + '><label for="terms">I accept the terms and conditions.</label></div>' +
        (e.terms ? '<p class="err" id="terms-e">You must accept to continue.</p>' : '') +
        '<button class="btn full" type="submit">Create account</button>'
      );
    }
    return {
      title: 'Create an account',
      html:
        '<div class="wrap page"><div class="form-narrow"><h1 class="t-head">Create an account</h1>' +
        '<p class="note" style="margin:1rem 0 1.5rem">Prototype: no account is created and nothing you type is stored.</p>' +
        '<form id="f" novalidate>' + formHtml() + '</form>' +
        '<p style="margin-top:1.5rem">Already have an account? <a class="link" href="#/signin' + next + '">Sign in</a></p></div></div>',
      after: function (root) {
        var f = U.$('#f', root);
        f.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var e = {};
          if (!f.elements.name.value.trim()) e.name = 'This field is required.';
          if (!/^\S+@\S+\.\S+$/.test(f.elements.email.value.trim())) e.email = 'Enter a valid email address.';
          if (f.elements.password.value.length < PASSWORD_MIN) e.password = 'This password is shorter than the minimum shown above.';
          if (!f.elements.terms.checked) e.terms = true;
          if (Object.keys(e).length) {
            f.innerHTML = formHtml(e);
            var bad = U.$('[aria-invalid=true]', f);
            if (bad) bad.focus();
            return;
          }
          signIn(query, 'Account created (sample).');
        });
      },
    };
  }

  function account() {
    if (!D.state.signedIn) {
      return { title: 'Sign in', html: '<div class="wrap page"><h1 class="t-head">Account</h1><p style="margin:1rem 0">Please sign in to continue.</p><a class="btn" href="#/signin?next=%2Faccount">Sign in</a></div>' };
    }
    return {
      title: 'Account',
      html:
        '<div class="wrap page"><h1 class="t-head">Account</h1>' +
        '<section class="block"><h2>Profile</h2><p>[Sample customer]<br><span class="muted">[sample@example.test]</span></p></section>' +
        '<section class="block"><h2>Your orders</h2><p><a class="link" href="#/orders">My orders</a></p></section>' +
        '<div class="actions" style="margin-top:2rem"><button class="btn ghost" type="button" id="out">Sign out</button></div></div>',
      after: function (root) {
        U.$('#out', root).addEventListener('click', function () {
          D.state.signedIn = false;
          D.save();
          U.syncAccount();
          U.toast('Signed out.');
          location.hash = '#/';
        });
      },
    };
  }

  (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push(['/signin', sign], ['/register', register], ['/account', account]);
})();
