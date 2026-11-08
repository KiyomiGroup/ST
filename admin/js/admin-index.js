/* StreetTasker Admin: Overview page (stage A3a). It shows who is signed in and what the shell knows.
   It reads no table and shows no number: the real dashboard is stage A4. */
'use strict';
AdminShell.init({ page: 'index', title: 'Overview', permission: null }).then(function (ctx) {
  var box = document.getElementById('adWho');
  var roles = ctx.access.roles || [];
  var perms = ctx.access.permissions || [];
  document.getElementById('adWelcome').textContent = 'Welcome' + (ctx.access.display_name ? ', ' + ctx.access.display_name : '');
  var list = document.getElementById('adRoles');
  while (list.firstChild) list.removeChild(list.firstChild);
  if (!roles.length) {
    var none = document.createElement('li'); none.className = 'ad-chip'; none.textContent = 'No role'; list.appendChild(none);
  }
  roles.forEach(function (r) {
    var li = document.createElement('li');
    li.className = 'ad-chip';
    li.textContent = String(r).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    list.appendChild(li);
  });
  document.getElementById('adPermCount').textContent = String(perms.length);
  box.hidden = false;
});
