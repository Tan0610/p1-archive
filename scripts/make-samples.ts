/**
 * Generates stand-in folios for the demo: pothi-format SVG "photographs" of
 * birch-bark and palm-leaf leaves, plus plain-text catalogue notes.
 *
 * They are drawings, not real manuscripts, and say so. The "script" is
 * abstract pen strokes from a seeded random walk, so the output is identical
 * on every machine (deterministic → the same SHA-256 every run).
 *
 *   npm run make:samples
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'samples', 'folios')

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n: number) => n.toFixed(1)

type Material = 'birch' | 'palm'

interface Leaf {
  file: string
  title: string
  note: string
  material: Material
  seed: number
  lines: number
  margin?: Array<{ color: string; y: number }>
  drawing?: 'plant' | 'wheel' | 'table'
  stain?: boolean
  text: string
}

function scriptLine(r: () => number, x0: number, x1: number, y: number, ink: string): string {
  let d = ''
  let x = x0
  while (x < x1) {
    // one "syllable": a head stroke, a descender, maybe a vowel mark
    const w = 10 + r() * 14
    d += `M${f(x)} ${f(y - 7)}h${f(w * 0.8)}`
    d += `M${f(x + w * 0.35)} ${f(y - 7)}q${f(r() * 6 - 3)} ${f(8 + r() * 4)} ${f(r() * 6 - 1)} ${f(12 + r() * 5)}`
    if (r() > 0.6) d += `M${f(x + w * 0.2)} ${f(y - 10)}q${f(w * 0.3)} ${f(-6 - r() * 4)} ${f(w * 0.6)} 0`
    x += w + (r() > 0.85 ? 16 : 3)
    if (r() > 0.93) {
      d += `M${f(x)} ${f(y - 9)}v${f(15)}` // shad (phrase mark)
      x += 10
    }
  }
  return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" opacity="0.88"/>`
}

function leafSvg(leaf: Leaf): string {
  const r = rng(leaf.seed)
  const W = 1200
  const H = leaf.material === 'birch' ? 320 : 250
  const ground = leaf.material === 'birch' ? ['#f3dccb', '#e9c3a8', '#d9a888'] : ['#e7cf96', '#d4b06a', '#b98e45']
  const ink = '#2b1d17'
  const parts: string[] = []

  parts.push(`<defs>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${ground[0]}"/><stop offset="0.55" stop-color="${ground[1]}"/><stop offset="1" stop-color="${ground[2]}"/>
  </linearGradient>
  <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${leaf.seed}"/><feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.2 0 0 0 0 0.12 0 0 0 0.16 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs>`)

  // leaf outline with torn-ish edges
  let top = `M14 ${f(12 + r() * 6)}`
  for (let x = 60; x <= W - 14; x += 46) top += ` L${x} ${f(8 + r() * 9)}`
  let bottom = ''
  for (let x = W - 14; x >= 14; x -= 46) bottom += ` L${x} ${f(H - 8 - r() * 9)}`
  const outline = `${top} L${W - 8} ${f(H / 2)}${bottom} L8 ${f(H / 2)} Z`
  parts.push(`<path d="${outline}" fill="url(#g)"/>`)
  parts.push(`<path d="${outline}" fill="#000" filter="url(#rough)"/>`)

  if (leaf.material === 'birch') {
    // lenticels: the short dark horizontal dashes birch bark is known for
    for (let i = 0; i < 70; i++) {
      const x = 20 + r() * (W - 40)
      const y = 16 + r() * (H - 32)
      parts.push(
        `<path d="M${f(x)} ${f(y)}h${f(6 + r() * 26)}" stroke="#8a5a45" stroke-width="${f(1 + r() * 1.6)}" stroke-linecap="round" opacity="${f(0.18 + r() * 0.25)}"/>`,
      )
    }
  } else {
    // palm-leaf ribs
    for (let y = 22; y < H - 16; y += 9 + r() * 5) {
      parts.push(`<path d="M20 ${f(y)} Q${W / 2} ${f(y + (r() * 4 - 2))} ${W - 20} ${f(y)}" stroke="#9c7433" stroke-width="0.8" fill="none" opacity="0.35"/>`)
    }
  }

  if (leaf.stain) {
    parts.push(`<path d="M${W * 0.62} ${H * 0.2} q120 -30 190 40 q40 90 -60 120 q-150 20 -170 -60 q-10 -70 40 -100z" fill="#6b3f22" opacity="0.18"/>`)
  }

  // ruled frame, binding holes
  parts.push(`<rect x="70" y="34" width="${W - 140}" height="${H - 68}" fill="none" stroke="#b8322a" stroke-width="1.2" opacity="0.55"/>`)
  for (const hx of [W * 0.3, W * 0.7]) {
    parts.push(
      `<circle cx="${f(hx)}" cy="${f(H / 2)}" r="13" fill="#2b1d17" opacity="0.85"/><circle cx="${f(hx)}" cy="${f(H / 2)}" r="18" fill="none" stroke="#b8322a" stroke-width="1" opacity="0.5"/>`,
    )
  }

  // text block, split around the drawing and the binding holes
  const lineGap = (H - 90) / leaf.lines
  for (let i = 0; i < leaf.lines; i++) {
    const y = 64 + i * lineGap
    const holeZone = Math.abs(y - H / 2) < 24
    const segments: Array<[number, number]> = holeZone
      ? [
          [90, W * 0.3 - 30],
          [W * 0.3 + 30, W * 0.7 - 30],
          [W * 0.7 + 30, W - 90],
        ]
      : [[90, W - 90]]
    for (const [a, b] of segments) {
      const end = leaf.drawing && a < W * 0.5 && b > W * 0.45 ? Math.min(b, W * 0.45) : b
      if (end - a > 30) parts.push(scriptLine(r, a, end, y, ink))
      if (leaf.drawing && b > W * 0.72 && a < W * 0.72) parts.push(scriptLine(r, W * 0.72 + 30, b, y, ink))
    }
  }

  if (leaf.drawing === 'plant') {
    const cx = W * 0.585
    parts.push(`<g stroke="#3f7f5e" stroke-width="2" fill="none" stroke-linecap="round">
  <path d="M${cx} ${H - 50} C${cx - 6} ${H - 120} ${cx + 10} ${H - 170} ${cx} 60"/>
  ${[0, 1, 2, 3, 4].map((i) => `<path d="M${cx} ${f(H - 80 - i * 36)} q${i % 2 ? 50 : -50} -10 ${i % 2 ? 70 : -70} -34" />`).join('')}
</g><circle cx="${cx}" cy="56" r="9" fill="#e2a93b" stroke="#b8322a" stroke-width="1.5"/>`)
  }
  if (leaf.drawing === 'wheel') {
    const cx = W * 0.585
    const cy = H / 2
    parts.push(`<g fill="none" stroke="#2b4c9b" stroke-width="2"><circle cx="${cx}" cy="${cy}" r="${H * 0.32}"/><circle cx="${cx}" cy="${cy}" r="${H * 0.12}" fill="#e2a93b" fill-opacity="0.35"/>
  ${Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2
    return `<path d="M${f(cx + Math.cos(a) * H * 0.12)} ${f(cy + Math.sin(a) * H * 0.12)} L${f(cx + Math.cos(a) * H * 0.32)} ${f(cy + Math.sin(a) * H * 0.32)}"/>`
  }).join('')}</g>`)
  }
  if (leaf.drawing === 'table') {
    const x0 = W * 0.47
    parts.push(
      `<g stroke="#2b1d17" stroke-width="1.2" fill="none">${Array.from({ length: 5 }, (_, i) => `<path d="M${x0} ${60 + i * 34}h${W * 0.23}"/>`).join('')}${Array.from({ length: 5 }, (_, i) => `<path d="M${f(x0 + i * W * 0.0575)} 60v136"/>`).join('')}</g>`,
    )
    for (let i = 0; i < 16; i++) {
      parts.push(
        `<circle cx="${f(x0 + 18 + (i % 4) * W * 0.0575)}" cy="${f(77 + Math.floor(i / 4) * 34)}" r="${f(3 + r() * 4)}" fill="${['#b8322a', '#2b4c9b', '#3f7f5e', '#e2a93b'][i % 4]}"/>`,
      )
    }
  }

  // marginal notes in different hands
  for (const m of leaf.margin ?? []) {
    // a short vertical run of handwriting in the right margin, between the frame and the edge
    const y = Math.min(Math.max(m.y, 40), H - 110)
    let d = `M${W - 46} ${y}`
    for (let k = 0; k < 4; k++) d += ` q${f(-5 - r() * 4)} 4 0 8 t0 8`
    parts.push(`<path d="${d}" fill="none" stroke="${m.color}" stroke-width="1.4" stroke-linecap="round" opacity="0.85"/>`)
  }

  parts.push(
    `<text x="${W - 80}" y="${H - 16}" text-anchor="end" font-family="Georgia, serif" font-size="13" fill="#2b1d17" opacity="0.55">stand-in drawing, not a real manuscript</text>`,
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${leaf.title}">
<title>${leaf.title}</title>
<desc>${leaf.note}</desc>
${parts.join('\n')}
</svg>
`
}

const LEAVES: Leaf[] = [
  {
    file: 'f001-medical-compendium-12r.svg',
    title: 'Medical compendium, folio 12 recto',
    note: 'Birch bark. Opening of the chapter on cold disorders; margin notes in three hands.',
    material: 'birch',
    seed: 11,
    lines: 7,
    margin: [
      { color: '#2b1d17', y: 90 },
      { color: '#b8322a', y: 170 },
      { color: '#2b4c9b', y: 250 },
    ],
    text: 'The chapter on cold disorders begins here. Three later readers annotated the right margin: one in black ink, one in red, one in blue.',
  },
  {
    file: 'f002-medical-compendium-12v.svg',
    title: 'Medical compendium, folio 12 verso',
    note: 'Birch bark. Continuation, with a herb drawn in green between the binding holes.',
    material: 'birch',
    seed: 23,
    lines: 7,
    drawing: 'plant',
    margin: [{ color: '#b8322a', y: 120 }],
    text: 'Verso of 12. A herb is drawn in green between the binding holes; the red hand adds a note beside it.',
  },
  {
    file: 'f003-astrological-table.svg',
    title: 'Palm-leaf astrological table',
    note: 'Palm leaf. A grid of coloured dots, probably a calendar of auspicious days.',
    material: 'palm',
    seed: 37,
    lines: 5,
    drawing: 'table',
    text: 'Palm leaf with a four-by-four table of coloured dots. Probably a calendar of auspicious days; needs a specialist.',
  },
  {
    file: 'f004-birch-scroll-fragment.svg',
    title: 'Birch-bark scroll fragment',
    note: 'Birch bark. Water damage at the right; the text is still legible.',
    material: 'birch',
    seed: 41,
    lines: 8,
    stain: true,
    text: 'Fragment of a longer scroll. A water stain covers the upper right but the lines under it are still readable.',
  },
  {
    file: 'f005-treatise-opening-leaf.svg',
    title: 'Philosophical treatise, opening leaf',
    note: 'Birch bark. Wheel diagram at the centre of the opening leaf.',
    material: 'birch',
    seed: 53,
    lines: 6,
    drawing: 'wheel',
    text: 'Opening leaf of a treatise. A twelve-spoked wheel is drawn in lapis blue in the centre of the page.',
  },
  {
    file: 'f006-palm-leaf-hymn.svg',
    title: 'Palm-leaf hymn, leaf 3',
    note: 'Palm leaf. Dense script, both binding holes intact.',
    material: 'palm',
    seed: 67,
    lines: 6,
    text: 'Leaf 3 of a short hymn. Both string holes intact; edges browned but not brittle.',
  },
  {
    file: 'f007-colophon.svg',
    title: 'Colophon leaf',
    note: 'Birch bark. The scribe’s closing note; second hand adds a later date.',
    material: 'birch',
    seed: 79,
    lines: 4,
    margin: [{ color: '#2b4c9b', y: 160 }],
    text: 'The colophon: where a scribe names the work and, sometimes, themselves. A second hand added a line later.',
  },
  {
    file: 'f008-damaged-leaf.svg',
    title: 'Damaged leaf, bundle 7',
    note: 'Birch bark. Heavy staining; photographed for the record before any conservation.',
    material: 'birch',
    seed: 97,
    lines: 7,
    stain: true,
    margin: [{ color: '#2b1d17', y: 200 }],
    text: 'Photographed before any conservation so there is a record of the leaf as it was found.',
  },
]

rmSync(out, { recursive: true, force: true })
mkdirSync(path.join(out, 'notes'), { recursive: true })

const meta: Record<string, { title: string; note: string }> = {}
for (const leaf of LEAVES) {
  writeFileSync(path.join(out, leaf.file), leafSvg(leaf), 'utf8')
  meta[leaf.file] = { title: leaf.title, note: leaf.note }
  const noteFile = `notes/${leaf.file.replace(/\.svg$/, '.txt')}`
  writeFileSync(
    path.join(out, ...noteFile.split('/')),
    `${leaf.title}\n\n${leaf.text}\n\nCatalogue note written for this demo. The image is a stand-in drawing; the real scans are Tsering's.\n`,
    'utf8',
  )
  meta[noteFile] = { title: `Note — ${leaf.title}`, note: 'Catalogue note' }
}
writeFileSync(path.join(out, 'folios.meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
console.log(`Wrote ${LEAVES.length} folios and ${LEAVES.length} notes to ${path.relative(root, out)}`)
