/* TEMP: placeholder pages for screens built in later stages of the prototype. Removed as each lands. */
(function () {
  'use strict';
  var pages = [
    ['/cart', 'Cart'], ['/checkout', 'Checkout'], ['/orders', 'My orders'],
  ];
  pages.forEach(function (p) {
    (window.PROTO_SCREENS = window.PROTO_SCREENS || []).push([p[0], function () {
      return { title: p[1], html: '<div class="wrap page"><h1 class="t-head">' + p[1] + '</h1><p class="note stage-note">This screen is built in a later stage of the prototype.</p></div>' };
    }]);
  });
})();
