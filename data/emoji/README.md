# Offline emoji catalogue

Pinned inputs (no downloads during a build or at runtime):

- [Unicode Emoji 17.0 emoji-test.txt](https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt)
- [CLDR 48 annotations](https://github.com/unicode-org/cldr/tree/release-48/common/annotations), `en.xml` and `zh.xml`
- [CLDR 48 derived annotations](https://github.com/unicode-org/cldr/tree/release-48/common/annotationsDerived), `en.xml` and `zh.xml`

All inputs and the derived catalogue are covered by the included Unicode License v3
(SPDX `Unicode-3.0`). Copyright © 1991–2025 Unicode, Inc.

Regenerate offline with `python3 scripts/generate-emoji-catalog.py`.
The generated TypeScript exports a compact string, parsed on first opening the Emoji
tab. Skin tones share their base entry's bilingual metadata. Every fully-qualified
sequence is retained, including mixed skin tones. Paste accepts whole catalogue
sequences and normalizes optional variation selectors. The runtime uses native text,
with no bundled images, fonts, remote resources, or picker dependencies.
