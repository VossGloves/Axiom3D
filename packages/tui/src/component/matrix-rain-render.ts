// Matrix-rain painter — pure logic, no JSX (mirrors bg-pulse-render.ts so it can be
// driven/tested without a renderer). Writes chars + colors straight into the frame
// buffer: near-black base, dim falling teal glyphs with soft trails, plus a vignette,
// scanlines, and a teal glow from the bottom-left — the axiom3d.html aesthetic.

import type { OptimizedBuffer } from "@opentui/core"

type Rgb = [number, number, number]

const BASE: Rgb = [7, 11, 13] // #070b0d
const GLYPH: Rgb = [45, 212, 191] // #2dd4bf
const HEAD: Rgb = [159, 232, 220] // #9fe8dc — brighter leading char
const SPACE = 0x20

const CHARS = "01{}[]<>/\\=+-*#$%&;:ｱｲｳｴｵｶｷｸｹｺｱｲｳｴｵｶｷｸｹｺ".split("")
const CHAR_CODES = CHARS.map((c) => c.codePointAt(0) ?? SPACE)

const TAIL = 14 // trail length in rows (the comet behind each head)
const MIN_SPEED = 0.0035 // rows per ms (slow, calm cadence like the source)
const MAX_SPEED = 0.0072
const GLYPH_DIM = 0.5 // cap on how bright a rain glyph ever gets (keeps text readable)
const RESPAWN_SPREAD = 40 // random start height above the viewport

function mix(base: Rgb, over: Rgb, amount: number): Rgb {
  const a = amount < 0 ? 0 : amount > 1 ? 1 : amount
  return [
    Math.round(base[0] + (over[0] - base[0]) * a),
    Math.round(base[1] + (over[1] - base[1]) * a),
    Math.round(base[2] + (over[2] - base[2]) * a),
  ]
}

function randomChar(): number {
  return CHAR_CODES[(Math.random() * CHAR_CODES.length) | 0] ?? SPACE
}

export class MatrixRainPainter {
  private width = 0
  private height = 0
  private head = new Float32Array(0) // leading row per column
  private speed = new Float32Array(0) // rows per ms per column
  private glyphs = new Uint16Array(0) // stable glyph per cell, written as a head passes
  private shade = new Float32Array(0) // precomputed vignette darkening per cell
  private glow = new Float32Array(0) // precomputed teal glow add per cell

  render(frameBuffer: OptimizedBuffer, deltaTime = 0) {
    const width = frameBuffer.width
    const height = frameBuffer.height
    if (width !== this.width || height !== this.height) this.resize(width, height)
    if (width === 0 || height === 0) return

    const dt = Math.min(Math.max(deltaTime, 0), 120) // clamp so a stall can't jump the rain
    this.advance(dt)
    this.paint(frameBuffer)
  }

  private resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.head = new Float32Array(width)
    this.speed = new Float32Array(width)
    this.glyphs = new Uint16Array(width * height)
    this.shade = new Float32Array(width * height)
    this.glow = new Float32Array(width * height)

    for (let x = 0; x < width; x++) {
      this.head[x] = Math.random() * (height + RESPAWN_SPREAD) - RESPAWN_SPREAD
      this.speed[x] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)
    }
    for (let i = 0; i < this.glyphs.length; i++) this.glyphs[i] = randomChar()

    // Static per-cell overlays: vignette (darken toward edges) + glow (bottom-left).
    const cx = width * 0.5
    const cy = height * 0.45
    const reach = Math.max(width, height) * 0.5
    const glowX = width * 0.2
    const glowY = height * 1.1
    const glowRadius = Math.max(width, height) * 0.55
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const dx = (x - cx) / reach
        const dy = (y - cy) / reach
        const radial = Math.sqrt(dx * dx + dy * dy)
        const edge = radial <= 0.25 ? 0 : (radial - 0.25) / 0.75
        this.shade[i] = (edge > 1 ? 1 : edge) * 0.75
        const gx = (x - glowX) / glowRadius
        const gy = (y - glowY) / glowRadius
        const gr = Math.sqrt(gx * gx + gy * gy)
        this.glow[i] = (gr >= 1 ? 0 : 1 - gr) * 0.1
      }
    }
  }

  private advance(dt: number) {
    for (let x = 0; x < this.width; x++) {
      const prev = Math.floor(this.head[x])
      this.head[x] += this.speed[x] * dt
      if (this.head[x] - TAIL > this.height) {
        // Restart above the viewport with a fresh speed.
        this.head[x] = -Math.random() * RESPAWN_SPREAD
        this.speed[x] = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)
        continue
      }
      // Stamp a fresh glyph into every cell the head just crossed so the trail reads
      // as characters being written as they fall.
      const next = Math.floor(this.head[x])
      for (let row = prev + 1; row <= next; row++) {
        if (row >= 0 && row < this.height) this.glyphs[row * this.width + x] = randomChar()
      }
    }
  }

  private paint(frameBuffer: OptimizedBuffer) {
    const { char: charBuf, fg, bg } = frameBuffer.buffers
    const width = this.width
    const height = this.height
    for (let y = 0; y < height; y++) {
      const scanline = y % 3 === 0 ? 5 : 0 // faint bright line every 3 rows
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const off = i * 4
        const shade = this.shade[i]
        const glow = this.glow[i]
        const inv = 1 - shade

        bg[off] = Math.round(BASE[0] * inv + GLYPH[0] * glow) + scanline
        bg[off + 1] = Math.round(BASE[1] * inv + GLYPH[1] * glow) + scanline
        bg[off + 2] = Math.round(BASE[2] * inv + GLYPH[2] * glow) + scanline
        bg[off + 3] = 255

        const distance = this.head[x] - y
        if (distance >= 0 && distance < TAIL) {
          const falloff = 1 - distance / TAIL
          const strength = (0.03 + GLYPH_DIM * falloff) * inv
          const tint = distance < 1 ? HEAD : GLYPH
          const [r, g, b] = mix(BASE, tint, strength)
          fg[off] = r
          fg[off + 1] = g
          fg[off + 2] = b
          fg[off + 3] = 255
          charBuf[i] = this.glyphs[i]
        } else {
          fg[off] = BASE[0]
          fg[off + 1] = BASE[1]
          fg[off + 2] = BASE[2]
          fg[off + 3] = 255
          charBuf[i] = SPACE
        }
      }
    }
  }
}