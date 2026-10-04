/* Runs before the stylesheets paint (a classic script, so it blocks): applies the saved theme and motion so a dark
   profile never flashes light. main.js writes fluentish.boot whenever the prefs change. */
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('fluentish.boot') || '{}');
    var r = document.documentElement;
    if (p.theme === 'light' || p.theme === 'dark') r.setAttribute('data-theme', p.theme);
    if (p.motion === 'reduce' || p.motion === 'full') r.setAttribute('data-motion', p.motion);
  } catch (e) { /* storage blocked: system defaults */ }
})();
