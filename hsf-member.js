// HSF membership helper: stores the secret member code in the browser,
// verifies it, and renders gate UI where a page needs membership.
(function () {
  var KEY = 'hsf_member_code';
  window.hsfMember = {
    code: function () { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    save: function (c) { try { localStorage.setItem(KEY, c); } catch (e) {} },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
    verify: function () {
      var c = this.code();
      if (!c) return Promise.resolve(null);
      return fetch('/api/join?code=' + encodeURIComponent(c))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return d && d.ok ? d.ig : null; })
        .catch(function () { return null; });
    },
    // Renders into el: either "Posting as @you" or a join prompt. Calls back with the code or ''.
    gate: function (el, cb) {
      var self = this;
      this.verify().then(function (ig) {
        if (ig) {
          el.innerHTML = 'Member <strong>@' + ig.replace(/[&<>"']/g, '') + '</strong> - you are good to go. <a href="#" id="hsf-not-me">Not you?</a>';
          el.className = 'member-chip ok';
          var nm = el.querySelector('#hsf-not-me');
          if (nm) nm.addEventListener('click', function (e) { e.preventDefault(); self.clear(); self.gate(el, cb); });
          cb(self.code(), ig);
        } else {
          el.innerHTML = 'Members only (free, 30 seconds). <a href="join.html">Join with your Instagram</a> first, then come back.';
          el.className = 'member-chip';
          cb('', null);
        }
      });
    }
  };
})();
