/* TEMP: placeholder pages for screens built in later stages of the prototype. Removed as each lands. */
(function () {
  'use strict';
  var pages = [
    ['/shop', 'Shop'], ['/search', 'Search'], ['/product/:slug', 'Product'], ['/fit/:slug', 'Find my size'],
    ['/fit-concept', 'Height and weight (concept)'], ['/cart', 'Cart'], ['/checkout', 'Checkout'],
    ['/signin', 'Sign in'], ['/register', 'Register'], ['/account', 'Account'], ['/orders', 'My orders'],
  ];
  pages.forEach(function (p) {
    (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push([p[0], function () {
      return { title: p[1], html: '<div class="wrap page"><h1 class="t-head">' + p[1] + '</h1><p class="note stage-note">This screen is built in a later stage of the prototype.</p></div>' };
    }]);
  });
})();
