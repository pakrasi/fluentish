# @paper-design/shaders 0.0.81 (vendored)

The mesh-gradient atmosphere behind the Today hero (src/core/brand.js `atmosphere()`). Vendored so this origin loads
no third-party JavaScript at runtime (review B6, CSP `script-src 'self'`).

- Source: npm `@paper-design/shaders@0.0.81`, `dist/`, Apache-2.0 (LICENSE and NOTICE in this folder).
- Tarball sha256: `65e31106239e9c2da8be52c4371d61efe625fa95fb9f2944977be9622c2aba88`
- Files: only the dependency closure of `shader-mount.js`, `get-shader-color-from-string.js`, `shader-sizing.js` and
  `shaders/mesh-gradient.js`. The only change: the `//# sourceMappingURL` lines are removed (the maps are not vendored).

| File | sha256 after the change |
|---|---|
| get-shader-color-from-string.js | 060be66eb645924c39887403992cc2c111927ad8f8587cf4c96fbcfadb8791c3 |
| shader-mount.js | 4c0b852f645b3acc273c624da76edf5f2b24e2afa2fa1b1aefb7f5d68c1d4909 |
| shader-sizing.js | 39a33aa83d15265ad31b92cbb1d007ed5c9f5d2c4d2fb92efda52f9f6ef0d7ed |
| shader-utils.js | c2c2483c7064650858a89a966df0b4f1f5e9c21ea590659eb462bc3ae73c46e8 |
| vertex-shader.js | 719a8ce8965375078cd09a6b6610196f7441db0f6ba0b64a5aa8675734e221a0 |
| shaders/mesh-gradient.js | 50e82f183a723ef678ae38edeef4377d69a6602b1182e056777af326db955fb8 |

To update: `npm pack @paper-design/shaders@<v>`, copy the same closure, strip the source-map lines, update this table,
and look at the Today hero in both themes.
