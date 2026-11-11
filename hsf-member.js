// HSF membership helper: session-cookie based. The cookie is HttpOnly; this
// script only asks the server who is signed in and renders gate UI.
(function () {
  function esc(t) { return String(t).replace(/[&<>"']/g, ''); }
  window.hsfMember = {
    current: null,
    ready: function () {
      var self = this;
      return fetch('/api/join?session=1', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { self.current = d && d.ok ? d.member : null; return self.current; })
        .catch(function () { self.current = null; return null; });
    },
    logout: function () {
      return fetch('/api/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      }).then(function () { location.reload(); });
    },
    // Renders into el: "Signed in as @you" or a join/login prompt. cb(signedIn, member).
    gate: function (el, cb) {
      var self = this;
      this.ready().then(function (m) {
        if (m) {
          el.innerHTML = 'Signed in as <strong>@' + esc(m.ig) + '</strong>. <a href="#" id="hsf-logout">Log out</a>';
          el.className = 'member-chip ok';
          var lo = el.querySelector('#hsf-logout');
          if (lo) lo.addEventListener('click', function (e) { e.preventDefault(); self.logout(); });
          cb(true, m);
        } else {
          var next = encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
          el.innerHTML = 'Members only (free, 30 seconds). <a href="join.html?next=' + next + '">Join or log in</a> first, then come back.';
          el.className = 'member-chip';
          cb(false, null);
        }
      });
    }
  };
})();
