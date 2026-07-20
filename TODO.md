# Follow-ups

Known, deliberate deferrals — behavior quirks the 2026-07 refactor documented
but did not change, plus improvement candidates it surfaced. Each is small and
self-contained; none blocks current functionality.

## Finish the asset-picker extraction

The entry drawer's image field (src/client/editors/asset-picker.ts) reuses
api.upload/getAssets but the image swap panel (editors/image.ts) still carries
its own copy of the drop-zone + asset-list wiring. Fold image.ts onto
buildImageField (keeping its live-<img> preview behaviour) so the upload/list
UI exists once.
