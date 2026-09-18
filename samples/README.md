# Sample folios

These are **stand-in drawings**, not photographs of real manuscripts. `npm run make:samples`
generates them deterministically (same bytes, same SHA-256, on every machine):

- eight pothi-format leaves in SVG — birch bark with its lenticels, palm leaf with its ribs,
  binding holes, abstract pen strokes in place of script, a herb, a wheel diagram, a table of
  coloured dots, water stains, and marginal notes in three inks;
- one plain-text catalogue note per leaf in `notes/`;
- `folios.meta.json` with human titles (read by the publisher, not uploaded).

Every leaf is larger than one 4 KB Swarm chunk, which is the point: the folios travel as their
own collection, and the feed only ever carries a 32-byte reference to it.

To publish real scans, point the tool at them: `npm run archive -- publish --dir /path/to/scans`.
