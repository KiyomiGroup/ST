/* StreetTasker Admin: Help (stage A3c). Static page: the shell checks the sign-in, then the page is shown. No data is read or written. */
'use strict';
AdminShell.init({ page: 'help', title: 'Help', permission: null }).then(function () {
  document.getElementById('adHelp').hidden = false;
});
