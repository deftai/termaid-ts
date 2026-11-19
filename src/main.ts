#!/usr/bin/env node
// Ported from src/termaid/__main__.py, which is what `python -m termaid` runs. Here it is what `bin` points at.

import { main } from "./cli.ts";

process.exit(main(process.argv.slice(2)));
