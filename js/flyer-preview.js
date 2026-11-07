/* Design-check page for the flyer. Sample data only. Safe to delete once the Tasker profile button is live. */
(function () {
  'use strict';
  var SAMPLES = [
    { label: '1. Full profile', data: { name: 'Emeka Okafor', profession: 'Plumber', location: 'Lekki, Lagos', services: ['Pipe repairs & leak fixing', 'Bathroom installations', 'Water heater servicing'], qrUrl: 'https://streettasker.com/signup.html?ref=ST4K9X2A&redirect=tasker-profile.html%3Fid%3D0f6b46a1-2c3d-4e5f-8a9b-1c2d3e4f5a6b' } },
    { label: '2. Long name, one service', data: { name: 'Oluwaseyifunmilayo Adebayo-Johnson', profession: 'Electrical installation and maintenance', location: 'Victoria Island, Lagos Island, Lagos State', services: ['Domestic and commercial wiring, inverter and solar installation'], qrUrl: 'https://streettasker.com/signup.html?ref=ST7M2Q9Z&redirect=tasker-profile.html%3Fid%3D1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' } },
    { label: '3. Minimal (no location, no services)', data: { name: 'Amina', profession: '', location: '', services: [], qrUrl: 'https://streettasker.com/signup.html?ref=ST3B8K5W&redirect=tasker-profile.html%3Fid%3D9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a' } }
  ];
  var host = document.getElementById('flpHost'), select = document.getElementById('flpSample'), photo = '', current = null, objectUrl = '';

  SAMPLES.forEach(function (s, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = s.label; select.appendChild(o); });

  function draw() {
    var d = Object.assign({}, SAMPLES[Number(select.value)].data, { photoUrl: photo });
    var width = Math.min(host.parentNode.clientWidth - 32, 460);
    current = STFlyer.render(host, d);
    STFlyer.setWidth(current.el, width);
  }
  select.addEventListener('change', draw);
  document.getElementById('flpPhoto').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = f ? URL.createObjectURL(f) : ''; photo = objectUrl; draw();
  });
  document.getElementById('flpPrintA5').addEventListener('click', function () { if (current) STFlyer.print(current.el, 'a5'); });
  document.getElementById('flpPrintA4').addEventListener('click', function () { if (current) STFlyer.print(current.el, 'a4'); });
  window.addEventListener('resize', function () { if (current) STFlyer.setWidth(current.el, Math.min(host.parentNode.clientWidth - 32, 460)); });
  draw();
})();
