/* GitHub Pages serves 404.html for unknown paths: /fluentish/exam/3 → /fluentish/#/exam/3 (path-shaped deep links). */
(function () {
  var base = '/fluentish/';
  var p = location.pathname;
  var rest = p.indexOf(base) === 0 ? p.slice(base.length) : p.replace(/^\//, '');
  location.replace(base + location.search + (rest ? '#/' + rest.replace(/\/$/, '') : ''));
})();
