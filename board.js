(function () {
  var ROLE_LABELS = {
    director: 'Director', producer: 'Producer', screenwriter: 'Screenwriter',
    dp: 'Cinematographer / DP', 'camera-op': 'Camera Operator', gaffer: 'Gaffer / Lighting',
    'sound-mixer': 'Sound Mixer', 'boom-op': 'Boom Operator', sound: 'Sound Mixer / Boom Op',
    'production-design': 'Production Designer / Art',
    costume: 'Costume', makeup: 'Makeup / SFX', editor: 'Editor', colorist: 'Colorist',
    composer: 'Composer / Sound Designer',
    'lead-actor': 'Lead Actor', 'supporting-actor': 'Supporting Actor', extra: 'Extra', actor: 'Actor',
    pa: 'Production Assistant',
    'script-supervisor': 'Script Supervisor', stunts: 'Stunt / Fight Choreographer',
    vfx: 'VFX / Animator', 'graphic-design': 'Graphic Designer', social: 'Social / Marketing',
    other: 'Other'
  };
  // Order for the filter dropdown and signup modal.
  var ROLE_ORDER = ['director', 'producer', 'screenwriter', 'dp', 'camera-op', 'gaffer',
    'sound-mixer', 'boom-op', 'production-design', 'costume', 'makeup', 'editor', 'colorist',
    'composer', 'lead-actor', 'supporting-actor', 'extra', 'pa', 'script-supervisor', 'stunts',
    'vfx', 'graphic-design', 'social', 'other'];
  var COMP_LABELS = { paid: 'Paid', unpaid: 'Unpaid', deferred: 'Deferred / TBD' };
  var projects = [];
  var map = null, markers = [];
  var tsWidget = null;

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
  function countsOf(p) {
    try {
      var c = typeof p.signup_counts === 'string' ? JSON.parse(p.signup_counts) : p.signup_counts;
      return c && typeof c === 'object' ? c : {};
    } catch (e) { return {}; }
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
        var counts = countsOf(p);
        return '<article class="card">' +
          '<div class="tags">' +
            '<span class="pill">' + esc(p.genre) + '</span>' +
            '<span class="tag comp-' + esc(p.compensation) + '">' + esc(COMP_LABELS[p.compensation] || p.compensation) + '</span>' +
          '</div>' +
          '<h3>' + esc(p.title) + '</h3>' +
          '<p class="where">' + esc(p.city) + (p.region ? ', ' + esc(p.region) : '') + '</p>' +
          '<p class="desc">' + esc(p.logline) + '</p>' +
          (roles.length ? '<div class="tags role-tags">' + roles.map(function (r) {
            var n = counts[r] || 0;
            return '<button type="button" class="tag role-tag" data-p="' + p.id + '" data-r="' + esc(r) + '" title="Sign up for this role">' +
              esc(ROLE_LABELS[r] || r) + (n ? ' <span class="cnt">' + n + '</span>' : '') + '</button>';
          }).join('') + '</div>' +
          '<p class="role-hint">Tap a role to sign up for it.</p>' : '') +
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

  // ---- Role sign-up modal ----
  var modal = document.getElementById('signup-modal');
  var suProject = null, suRole = null;
  function suMsg(t, ok) {
    var el = document.getElementById('su-msg');
    el.textContent = t;
    el.className = 'form-msg' + (ok ? ' ok' : '');
    el.hidden = false;
  }
  function openSignup(projectId, role) {
    suProject = null;
    for (var i = 0; i < projects.length; i++) if (projects[i].id === projectId) suProject = projects[i];
    if (!suProject) return;
    suRole = role;
    document.getElementById('su-title').textContent = ROLE_LABELS[role] || role;
    document.getElementById('su-project').textContent = suProject.title + ' - ' + suProject.city + (suProject.region ? ', ' + suProject.region : '');
    document.getElementById('su-name').value = '';
    document.getElementById('su-age').value = '';
    document.getElementById('su-ig').value = '';
    document.getElementById('su-msg').hidden = true;
    document.getElementById('su-send').disabled = false;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (window.turnstile) {
      if (tsWidget === null) {
        tsWidget = turnstile.render('#su-turnstile', { sitekey: '0x4AAAAAAF9K5KyKqg8cTWhp', theme: 'dark' });
      } else {
        turnstile.reset(tsWidget);
      }
    }
  }
  function closeSignup() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('su-close').addEventListener('click', closeSignup);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeSignup(); });
  document.getElementById('su-send').addEventListener('click', function () {
    var btn = document.getElementById('su-send');
    var name = document.getElementById('su-name').value.trim();
    var age = document.getElementById('su-age').value;
    var ig = document.getElementById('su-ig').value.trim().replace(/^@/, '');
    var token = '';
    var tel = document.querySelector('#su-turnstile [name=cf-turnstile-response]');
    if (tel) token = tel.value;
    if (!name || !age) { suMsg('Add your first name and age range.'); return; }
    btn.disabled = true;
    fetch('/api/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: suProject.id, role: suRole, first_name: name,
        age_range: age, ig_handle: ig, turnstile_token: token
      })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          suMsg('Signed up. The project owner can see your response now.', true);
          var c = countsOf(suProject);
          c[suRole] = (c[suRole] || 0) + 1;
          suProject.signup_counts = JSON.stringify(c);
          setTimeout(function () { closeSignup(); render(); }, 1200);
        } else {
          suMsg(res.d.error === 'you already signed up for this role' ? 'You already signed up for this role.' :
                res.d.error === 'slow down - try again later' ? 'Slow down - try again in a bit.' :
                'Something went wrong. Try again.');
          btn.disabled = false;
          if (window.turnstile && tsWidget !== null) turnstile.reset(tsWidget);
        }
      }).catch(function () {
        suMsg('Network trouble. Try again.');
        btn.disabled = false;
      });
  });

  function loadFilters() {
    var st = document.getElementById('filter-state');
    Array.from(new Set(projects.map(function (p) { return p.region; }).filter(Boolean))).sort()
      .forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        st.appendChild(o);
      });
    var rl = document.getElementById('filter-role');
    ROLE_ORDER.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = ROLE_LABELS[k];
      rl.appendChild(o);
    });
  }
  ['filter-genre', 'filter-role', 'filter-state'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', render);
  });
  document.getElementById('cards').addEventListener('click', function (e) {
    var roleBtn = e.target.closest('.role-tag');
    if (roleBtn) {
      openSignup(Number(roleBtn.dataset.p), roleBtn.dataset.r);
      return;
    }
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
