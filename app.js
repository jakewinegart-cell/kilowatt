(function () {
  'use strict';
  var VERSION = 'kw1';
  var KEY = 'kilowatt.v1';
  var RATES = window.KW_RATES || {};
  var SRC = window.KW_RATE_SOURCE || { label: 'EIA', url: 'https://www.eia.gov/electricity/monthly/' };

  var TYPES = [
    { id: 'led', label: 'LED', w: 9 },
    { id: 'incandescent', label: 'Incandescent', w: 60 },
    { id: 'cfl', label: 'CFL', w: 14 },
    { id: 'halogen', label: 'Halogen', w: 43 },
    { id: 'tube', label: 'Fluorescent tube', w: 32 },
    { id: 'smart', label: 'Smart LED', w: 9 },
    { id: 'custom', label: 'Other / custom', w: 10 }
  ];
  function typeById(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i]; return TYPES[0]; }

  // ---------- state ----------
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function newLight(n) {
    return { id: uid(), name: 'Light ' + n, type: 'led', watts: 9, volts: 120, amps: '', location: '', hours: 5, on: false, onSince: null };
  }
  function defaults() {
    return { version: VERSION, stateCode: 'MT', rateOverride: '', lights: [newLight(1)], saved: { year: new Date().getFullYear(), total: 0, log: [] } };
  }
  var S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !Array.isArray(S.lights)) S = defaults();
  if (!S.saved) S.saved = { year: new Date().getFullYear(), total: 0, log: [] };
  if (!RATES[S.stateCode]) S.stateCode = 'MT';
  S.version = VERSION;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }

  function checkYear() {
    var y = new Date().getFullYear();
    if (S.saved.year !== y) { S.saved = { year: y, total: 0, log: [] }; save(); return true; }
    return false;
  }
  checkYear();

  // ---------- math ----------
  function num(v, d) { var n = parseFloat(v); return isFinite(n) && n >= 0 ? n : d; }
  function rateCents() {
    var o = num(S.rateOverride, NaN);
    if (isFinite(o) && o > 0) return o;
    return RATES[S.stateCode] ? RATES[S.stateCode].c : RATES.US.c;
  }
  function rate$() { return rateCents() / 100; }
  function watts(l) { return num(l.watts, 0); }
  function hours(l) { return Math.min(24, num(l.hours, 0)); }
  function perHour(l) { return watts(l) / 1000 * rate$(); }
  function perDay(l) { return perHour(l) * hours(l); }
  function perYear(l) { return perDay(l) * 365; }

  function money(v, dp) {
    if (dp == null) dp = 2;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  // ---------- DOM helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  var lightsEl = $('lights');
  var tpl = $('lightTpl');

  function renderLights() {
    lightsEl.innerHTML = '';
    if (!S.lights.length) {
      var p = document.createElement('div'); p.className = 'panel empty';
      p.textContent = 'No lights yet. Tap “+ Add light” to start metering.';
      lightsEl.appendChild(p);
    }
    S.lights.forEach(function (l) { lightsEl.appendChild(buildLight(l)); });
    updateNumbers();
  }

  function buildLight(l) {
    var node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = l.id;
    node.classList.toggle('on', !!l.on);

    node.querySelectorAll('input[data-f]').forEach(function (inp) {
      var f = inp.dataset.f;
      inp.value = l[f] == null ? '' : l[f];
      inp.addEventListener('input', function () {
        l[f] = inp.value;
        if ((f === 'volts' || f === 'amps') && num(l.amps, 0) > 0 && num(l.volts, 0) > 0) {
          l.watts = Math.round(num(l.volts, 0) * num(l.amps, 0) * 10) / 10;
          node.querySelector('[data-f="watts"]').value = l.watts;
        }
        if (f === 'watts' && num(l.amps, 0) > 0) {
          // user typed watts directly — drop the amps-derived value
          l.amps = ''; node.querySelector('[data-f="amps"]').value = '';
        }
        save(); updateNumbers();
      });
    });

    var types = node.querySelector('.types');
    TYPES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio');
      b.textContent = t.label + ' · ' + t.w + 'W';
      b.setAttribute('aria-checked', String(l.type === t.id));
      b.addEventListener('click', function () {
        l.type = t.id; l.watts = t.w; l.amps = '';
        node.querySelector('[data-f="watts"]').value = l.watts;
        node.querySelector('[data-f="amps"]').value = '';
        types.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true');
        save(); updateNumbers();
      });
      types.appendChild(b);
    });

    var tg = node.querySelector('.toggle');
    tg.setAttribute('aria-checked', String(!!l.on));
    tg.addEventListener('click', function () { setOn(l, !l.on); });

    node.querySelector('.del').addEventListener('click', function () {
      if (!confirm('Remove “' + (l.name || 'this light') + '”?')) return;
      S.lights = S.lights.filter(function (x) { return x.id !== l.id; });
      save(); renderLights();
    });
    return node;
  }

  function setOn(l, on) {
    checkYear();
    if (on) {
      l.on = true; l.onSince = Date.now();
    } else {
      var amt = perYear(l);
      l.on = false; l.onSince = null;
      if (amt > 0) {
        S.saved.total += amt;
        S.saved.log.unshift({ t: Date.now(), name: l.name || 'Light', loc: l.location || '', amt: amt });
        if (S.saved.log.length > 200) S.saved.log.length = 200;
      }
    }
    save();
    var node = lightsEl.querySelector('[data-id="' + l.id + '"]');
    if (node) {
      node.classList.toggle('on', l.on);
      node.querySelector('.toggle').setAttribute('aria-checked', String(l.on));
    }
    updateNumbers(); renderLog();
  }

  function renderLog() {
    $('saved').textContent = money(S.saved.total);
    var ul = $('logList'); ul.innerHTML = '';
    $('logCount').textContent = S.saved.log.length ? '(' + S.saved.log.length + ')' : '';
    if (!S.saved.log.length) {
      var li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nothing yet — switch a light off to bank its yearly cost.';
      ul.appendChild(li); return;
    }
    S.saved.log.slice(0, 50).forEach(function (e) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      var nm = document.createElement('div'); nm.textContent = e.name + (e.loc ? ' · ' + e.loc : '');
      var wh = document.createElement('div'); wh.className = 'when';
      wh.textContent = new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      left.appendChild(nm); left.appendChild(wh);
      var amt = document.createElement('span'); amt.className = 'amt'; amt.textContent = '+' + money(e.amt);
      li.appendChild(left); li.appendChild(amt); ul.appendChild(li);
    });
    $('savedSub').textContent = 'Projected yearly cost avoided each time a light goes off · ' + S.saved.year;
  }

  function updateNumbers() {
    var c = rateCents();
    var usingOverride = isFinite(num(S.rateOverride, NaN)) && num(S.rateOverride, 0) > 0;
    $('rateShow').textContent = c.toFixed(2) + '¢';
    $('rateShow').title = usingOverride ? 'Your bill rate' : (RATES[S.stateCode] ? RATES[S.stateCode].name + ' average' : '');

    var day = 0, kwh = 0;
    S.lights.forEach(function (l) {
      day += perDay(l); kwh += watts(l) * hours(l) / 1000;
      var node = lightsEl.querySelector('[data-id="' + l.id + '"]');
      if (node) {
        node.querySelector('.lnow').textContent = money(perHour(l), 4) + '/hr · ' + watts(l) + 'W';
        node.querySelector('.lyear').textContent = money(perYear(l)) + '/yr';
      }
    });
    var now = new Date();
    var dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    $('pDay').textContent = money(day);
    $('pWeek').textContent = money(day * 7);
    $('pMonth').textContent = money(day * dim);
    $('pYear').textContent = money(day * 365);
    $('kwhLine').textContent = kwh.toFixed(2) + ' kWh/day at ' + c.toFixed(2) + '¢/kWh' + (usingOverride ? ' (your rate)' : ' (' + (RATES[S.stateCode] ? RATES[S.stateCode].name : '') + ' avg)') + ' · month = ' + dim + ' days';
    tick();
  }

  function tick() {
    var ph = 0, w = 0, n = 0, run = 0, t = Date.now();
    S.lights.forEach(function (l) {
      if (!l.on) return;
      n++; w += watts(l); ph += perHour(l);
      if (l.onSince) run += Math.max(0, t - l.onSince) / 3600000 * perHour(l);
    });
    $('perHour').textContent = money(ph, 4);
    $('onCount').textContent = n + (n === 1 ? ' light on' : ' lights on');
    $('onWatts').textContent = (Math.round(w * 10) / 10) + ' W';
    $('running').textContent = money(run, run < 1 ? 6 : 4);
  }

  // ---------- rate / location ----------
  var sel = $('stateSel');
  Object.keys(RATES).sort(function (a, b) {
    if (a === 'US') return 1; if (b === 'US') return -1;
    return RATES[a].name.localeCompare(RATES[b].name);
  }).forEach(function (k) {
    var o = document.createElement('option'); o.value = k;
    o.textContent = RATES[k].name + ' — ' + RATES[k].c.toFixed(2) + '¢/kWh';
    sel.appendChild(o);
  });
  sel.value = S.stateCode;
  sel.addEventListener('change', function () { S.stateCode = sel.value; save(); updateNumbers(); });
  var ro = $('rateOverride');
  ro.value = S.rateOverride || '';
  ro.addEventListener('input', function () { S.rateOverride = ro.value; save(); updateNumbers(); });
  $('srcLink').textContent = SRC.label; $('srcLink').href = SRC.url;

  var NAME2CODE = {};
  Object.keys(RATES).forEach(function (k) { NAME2CODE[RATES[k].name.toLowerCase()] = k; });

  function fetchJSON(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 8000);
    return fetch(url, ctl ? { signal: ctl.signal, headers: { 'Accept': 'application/json' } } : {}).then(function (r) {
      clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    });
  }
  function codeFromBDC(d) {
    if (!d || d.countryCode !== 'US') return null;
    var c = (d.principalSubdivisionCode || '').replace('US-', '');
    if (RATES[c]) return c;
    return NAME2CODE[(d.principalSubdivision || '').toLowerCase()] || null;
  }
  function codeFromNominatim(d) {
    var a = d && d.address; if (!a || a.country_code !== 'us') return null;
    var iso = (a['ISO3166-2-lvl4'] || '').replace('US-', '');
    if (RATES[iso]) return iso;
    return NAME2CODE[(a.state || '').toLowerCase()] || null;
  }

  $('geoBtn').addEventListener('click', function () {
    var msg = $('geoMsg');
    if (!navigator.geolocation) { msg.textContent = 'Location isn’t available in this browser — pick your state above.'; return; }
    msg.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude.toFixed(4), lon = pos.coords.longitude.toFixed(4);
      msg.textContent = 'Finding your state…';
      var q = '/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=en';
      fetchJSON('https://api-bdc.io' + q)
        .then(codeFromBDC)
        .catch(function () { return null; })
        .then(function (code) {
          if (code) return code;
          return fetchJSON('https://api.bigdatacloud.net' + q).then(codeFromBDC).catch(function () { return null; });
        })
        .then(function (code) {
          if (code) return code;
          return fetchJSON('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&lat=' + lat + '&lon=' + lon).then(codeFromNominatim).catch(function () { return null; });
        })
        .then(function (code) {
          if (code) {
            S.stateCode = code; sel.value = code; save(); updateNumbers();
            msg.textContent = 'Set to ' + RATES[code].name + ' (' + RATES[code].c.toFixed(2) + '¢/kWh). Your coordinates were sent only to the reverse-geocoder, never stored.';
          } else {
            msg.textContent = 'Couldn’t match your location to a US state — please pick it above.';
          }
        });
    }, function (err) {
      msg.textContent = (err && err.code === 1 ? 'Location permission denied' : 'Couldn’t get your location') + ' — pick your state above.';
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

  // ---------- buttons ----------
  $('addLight').addEventListener('click', function () {
    var l = newLight(S.lights.length + 1);
    S.lights.push(l); save(); renderLights();
    var node = lightsEl.querySelector('[data-id="' + l.id + '"]');
    if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('resetSaved').addEventListener('click', function () {
    if (!confirm('Reset this year’s savings tally and log to $0?')) return;
    S.saved = { year: new Date().getFullYear(), total: 0, log: [] }; save(); renderLog();
  });

  $('ver').textContent = VERSION; $('ver2').textContent = VERSION;
  window.KILOWATT_VERSION = VERSION;

  renderLights(); renderLog();
  setInterval(function () { if (checkYear()) renderLog(); tick(); }, 200);
  window.addEventListener('storage', function (e) { if (e.key === KEY) location.reload(); });
})();
