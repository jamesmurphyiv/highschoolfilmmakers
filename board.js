(function () {
  var ROLE_LABELS = {
    director: 'Director', producer: 'Producer', screenwriter: 'Screenwriter',
    dp: 'Cinematographer / DP', 'camera-op': 'Camera Operator', gaffer: 'Gaffer / Lighting',
    sound: 'Sound Mixer / Boom Op', 'production-design': 'Production Designer / Art',
    costume: 'Costume', makeup: 'Makeup / SFX', editor: 'Editor', colorist: 'Colorist',
    composer: 'Composer / Sound Designer', actor: 'Actor', pa: 'Production Assistant',
    'script-supervisor': 'Script Supervisor', stunts: 'Stunt / Fight Choreographer',
    vfx: 'VFX / Animator', 'graphic-design': 'Graphic Designer', social: 'Social / Marketing',
    other: 'Other'
  };
  var COMP_LABELS = { paid: 'Paid', unpaid: 'Unpaid', deferred: 'Deferred / TBD' };
  var projects = [];
  var map = null, markers = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rolesOf(p) {
    try {
      var r = typeof p.roles === 'string' ? JSON.parse(p.roles) : p.roles;
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  function igUrl(h) {
    var clean = String(h || '').replace(/^@/, '').trim();
    return /^[A-Za-z0-9._]{1,30}$/.test(clean) ? 'https://www.instagram.com/' + clean + '/' : null;
  }
  function filtered() {
    var genre = document.getElementById('filter-genre').value;
    var role = document.getElementById('filter-role').value;
    var st = document.getElementById('filter-state').value;
    return projects.filter(function (p) {
      return (!genre || p.genre === genre) &&
             (!role || rolesOf(p).indexOf(role) !== -1) &&
             (!st || (p.region || '') === st);
    });
  }
  function render() {
    var list = filtered();
    var cards = document.getElementById('cards');
    var status = document.getElementById('board-status');
    if (!list.length) {
      cards.innerHTML = '';
      status.hidden = false;
      status.textContent = projects.length
        ? 'Nothing matches those filters yet.'
        : 'No projects on the board yet. Yours could be the first.';
    } else {
      status.hidden = true;
      cards.innerHTML = list.map(function (p) {
        var ig = igUrl(p.ig_handle);
        var roles = rolesOf(p);
        return '<article class="card">' +
          '<div class="tags">' +
            '<span class="pill">' + esc(p.genre) + '</span>' +
            '<span class="tag comp-' + esc(p.compensation) + '">' + esc(COMP_LABELS[p.compensation] || p.compensation) + '</span>' +
          '</div>' +
          '<h3>' + esc(p.title) + '</h3>' +
          '<p class="where">' + esc(p.city) + (p.region ? ', ' + esc(p.region) : '') + '</p>' +
          '<p class="desc">' + esc(p.logline) + '</p>' +
          (roles.length ? '<div class="tags">' + roles.map(function (r) {
            return '<span class="tag">' + esc(ROLE_LABELS[r] || r) + '</span>';
          }).join('') + '</div>' : '') +
          (ig ? '<p class="contact">Contact: <a href="' + ig + '" target="_blank" rel="noopener">@' + esc(String(p.ig_handle).replace(/^@/, '')) + '</a> on Instagram</p>' : '') +
          '<button class="report-btn" data-id="' + p.id + '">Report this post</button>' +
          '</article>';
      }).join('');
    }
    if (map) {
      markers.forEach(function (m) { map.removeLayer(m); });
      markers = [];
      list.forEach(function (p) {
        if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
        var m = L.circleMarker([p.lat, p.lon], {
          radius: 8, color: '#93170f', weight: 2, fillColor: '#93170f', fillOpacity: 0.85
        }).addTo(map);
        var ig = igUrl(p.ig_handle);
        m.bindPopup('<span class="map-popup-title">' + esc(p.title) + '</span><br>' +
          esc(p.genre) + ' &middot; ' + esc(p.city) + (p.region ? ', ' + esc(p.region) : '') +
          (ig ? '<br><a href="' + ig + '" target="_blank" rel="noopener">Instagram</a>' : ''));
        markers.push(m);
      });
    }
  }
  function loadFilters() {
    var st = document.getElementById('filter-state');
    Array.from(new Set(projects.map(function (p) { return p.region; }).filter(Boolean))).sort()
      .forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        st.appendChild(o);
      });
    var rl = document.getElementById('filter-role');
    Object.keys(ROLE_LABELS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = ROLE_LABELS[k];
      rl.appendChild(o);
    });
  }
  ['filter-genre', 'filter-role', 'filter-state'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', render);
  });
  document.getElementById('cards').addEventListener('click', function (e) {
    var btn = e.target.closest('.report-btn');
    if (!btn) return;
    var reason = window.prompt('Why are you reporting this post? (optional)');
    if (reason === null) return;
    fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: Number(btn.dataset.id), reason: reason.slice(0, 300) })
    }).then(function () {
      btn.textContent = 'Reported. Thanks.';
      btn.disabled = true;
    }).catch(function () {
      btn.textContent = 'Report failed. Try again.';
    });
  });

  try {
    map = L.map('map', { scrollWheelZoom: false }).setView([39.5, -98.35], 4);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ', maxZoom: 16
    }).addTo(map);
  } catch (e) { document.getElementById('map').style.display = 'none'; }

  fetch('/api/projects').then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (data) {
      projects = Array.isArray(data.projects) ? data.projects : [];
      loadFilters();
      render();
    })
    .catch(function () {
      loadFilters();
      var status = document.getElementById('board-status');
      status.hidden = false;
      status.textContent = 'The board is warming up. Check back in a few minutes.';
    });
})();
