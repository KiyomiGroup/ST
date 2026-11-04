/* Stage 6D-3 test double (MOCKED Supabase, not the real project): storage upload / signed links and the three new functions.
   Scenario extras: SC.attachFail = a hint ('contact_info', 'bad_file', ...) the next send answers with (once). Records: window.__uploads, window.__att. */
(function () {
  var prev = window.supabase.createClient;
  window.supabase.createClient = function () {
    var client = prev.apply(this, arguments), base = client.rpc, SC = window.__SC || {};
    window.__uploads = []; window.__att = [];
    var GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    client.storage = { from: function (bucket) { return {
      upload: async function (path, blob, opts) { window.__uploads.push({ bucket: bucket, path: path, type: opts && opts.contentType, size: blob.size }); return { data: { path: path }, error: null }; },
      createSignedUrl: async function (path) { return { data: { signedUrl: GIF + '#' + encodeURIComponent(path) }, error: null }; }
    }; } };
    function push(args, type, body, payload) {
      var th = SC.chat.threads[args.p_booking]; th.messages.push({ id: 'new' + th.messages.length, kind: 'coordinator', type: type, body: body, payload: payload, author_name: 'Ngozi', author_is_me: true, created_at: '2026-10-28T10:0' + th.messages.length + ':00Z' });
      th.total_messages++;
    }
    client.rpc = async function (name, args) {
      if (name === 'open_local_thread') { window.__rpc.push(name); return { data: { thread_id: 't1', role: 'coordinator', read_only: false, created: false }, error: null }; }
      if (name === 'coordinator_send_attachment' || name === 'coordinator_send_location') {
        window.__att.push({ name: name, args: args }); window.__rpc.push(name);
        if (SC.attachFail) { var h = SC.attachFail; SC.attachFail = null; return { data: null, error: { hint: h, message: h === 'bad_file' ? 'A photo must be JPEG, PNG or WebP' : 'refused' } }; }
        if (name === 'coordinator_send_location') push(args, 'location', args.p_label || 'Shared location', { lat: args.p_lat, lng: args.p_lng, label: args.p_label || undefined });
        else push(args, args.p_kind === 'photo' ? 'image' : args.p_kind, args.p_caption || 'Photo', { attachment_id: 'a-' + args.p_request_id, path: args.p_path, name: args.p_name, size: 1000, mime: 'image/jpeg', caption: args.p_caption || undefined });
        return { data: { message_id: 'x', duplicate: false }, error: null };
      }
      return base.apply(client, arguments);
    };
    return client;
  };
})();
