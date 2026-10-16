// LAST BELL - start-up watchdog. A classic (non-module) script loaded before game.js, so it still
// runs when the game's modules can't load at all (old browser, blocked or missing file).
// game.js sets window.__lastBell.started = true as soon as its modules have loaded. If that never
// happens, the loading screen says why (errors caught here + browser version), so a bug-report
// screenshot carries the cause, and a 'boot-failed' moment goes to the HallPass SDK if it's there.
(function () {
  var boot = (window.__lastBell = window.__lastBell || { started: false, errors: [] });
  var t0 = Date.now();
  var shown = false;

  function note(msg) {
    if (!msg || boot.errors.length >= 4) return;
    msg = String(msg).slice(0, 220);
    for (var i = 0; i < boot.errors.length; i++) if (boot.errors[i] === msg) return;
    boot.errors.push(msg);
  }
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t !== window && (t.src || t.href)) note('Could not load ' + String(t.src || t.href).split('/').pop());
    else note((e && (e.message || (e.error && e.error.message))) || 'Script error');
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    note(r && (r.message || r));
  });

  function browser() {
    var ua = navigator.userAgent || '';
    var ios = ua.match(/OS (\d+)[._](\d+)/);
    var safari = ua.match(/Version\/([\d.]+)/);
    var chrome = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/);
    var firefox = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/);
    var parts = [];
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) parts.push((ios ? 'iOS ' + ios[1] + '.' + ios[2] : 'iOS'));
    if (chrome) parts.push('Chrome ' + chrome[1].split('.')[0]);
    else if (firefox) parts.push('Firefox ' + firefox[1].split('.')[0]);
    else if (safari) parts.push('Safari ' + safari[1]);
    return parts.join(', ') || ua.slice(0, 80);
  }

  function show(reason) {
    if (shown || boot.started) return;
    shown = true;
    var label = document.getElementById('loading-label');
    if (!label) return;
    var box = document.createElement('div');
    box.className = 'loading__error';
    var h = document.createElement('p');
    h.className = 'loading__error-title';
    h.textContent = "The game couldn't start in this browser.";
    box.appendChild(h);
    var p = document.createElement('p');
    p.textContent = reason;
    box.appendChild(p);
    for (var i = 0; i < boot.errors.length; i++) {
      var c = document.createElement('code');
      c.textContent = boot.errors[i];
      box.appendChild(c);
    }
    var b = document.createElement('p');
    b.className = 'loading__error-browser';
    b.textContent = browser() + ' · try updating the browser, or play on a computer.';
    box.appendChild(b);
    label.textContent = '';
    label.appendChild(box);
    try {
      if (window.HallPass && window.HallPass.moment) {
        var r = window.HallPass.moment('boot-failed', { reason: reason, errors: boot.errors.join(' | ').slice(0, 400), browser: browser() });
        if (r && r.catch) r.catch(function () {});
      }
    } catch (err) { /* ignore */ }
  }

  var noModules = !('noModule' in document.createElement('script'));
  function tick() {
    if (boot.started || shown) return;
    var waited = (Date.now() - t0) / 1000;
    if (noModules) return show('This browser is too old to run it (no JavaScript modules).');
    if (boot.errors.length && waited > 2) return show('Part of the game failed to load.');
    if (waited > 40) return show('It is taking far too long to load.');
    setTimeout(tick, 1000);
  }
  setTimeout(tick, 1500);
})();
