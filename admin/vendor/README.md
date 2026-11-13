# admin/vendor

`supabase-js-2.119.0.umd.js` is `dist/umd/supabase.js` from the npm package `@supabase/supabase-js@2.119.0`, saved unchanged (stage A27c, finding S-1).
The admin pages load it from here, not from a CDN, so nothing outside this site can change the code that runs in an admin's signed-in session.
npm registry integrity of the package: `sha512-MKP49G6bJbPhvsZDegZ/IXS/ITApPgplDCF5+F65KZ5kIArS5Y90WFxwvWYALx2bsxdrSuHvkCiXHYr3dU8+sw==`
SHA-256 of this file: see `SHA256SUMS` next to it.

To update: `npm pack @supabase/supabase-js@<exact version>`, take `package/dist/umd/supabase.js`, save it here under the new version name, update `SHA256SUMS`, change the script tag in every admin page, then run `docs/admin-control-centre/local-tests/a27c-csp-test.js`.
