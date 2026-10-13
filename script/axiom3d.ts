#!/usr/bin/env bun
// axiom3d — launch the Axiom3D dev build (opencode + the axiom3d Blender agent).
//
// Install once:   bun link        (run from the repo root)
// Then run:       axiom3d [args...]   — same as `bun run dev`, with args forwarded.
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
})

process.exit(await proc.exited)
