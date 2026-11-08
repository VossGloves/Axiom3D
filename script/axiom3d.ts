#!/usr/bin/env bun
// axiom3d — launch the Axiom3D dev build (opencode + the axiom3d Blender agent).
//
// Install once:   bun link        (run from the repo root)
// Then run:       axiom3d [args...]   — same as `bun run dev`, with args forwarded.
//
// Defaults AXIOM3D_BLENDER_MODE to "gui" so an explicit AXIOM3D_BLENDER_MODE=...
// in the environment still wins (e.g. AXIOM3D_BLENDER_MODE=headless axiom3d).
//
// Resolves the repo from this file's real path so it works through the `bun link`
// symlink from anywhere on your machine.

import { realpathSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(realpathSync(import.meta.dir), "..")
const opencodeDir = join(repoRoot, "packages", "opencode")

const proc = Bun.spawn(["bun", "run", "--cwd", opencodeDir, "src/index.ts", ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, AXIOM3D_BLENDER_MODE: process.env.AXIOM3D_BLENDER_MODE ?? "gui" },
})

process.exit(await proc.exited)
