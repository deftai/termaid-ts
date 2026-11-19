// WHAT this port is judged against: the Python termaid pinned to the commit Console vendors.
//
// `uvx` belongs to the machine running a check, never to this package: nothing here is a dependency, a consumer
// installs none of it, and the reference is fetched and cached the first time a harness asks for it.

const RUNNER = "uvx";
const FROM_FLAG = "--from";
/**
 * The distribution, carrying the extra a THEMED render needs. Without `rich` the reference REFUSES a theme outright
 * rather than drawing it plain, so a harness that left it out would compare a refusal against a drawing and call every
 * painted take a divergence.
 */
const DISTRIBUTION = "termaid[rich]";
const COMMAND = "termaid";

export const REFERENCE_REPO = "https://github.com/deftai/termaid";
export const REFERENCE_COMMIT = "0f2fb37f5cb65a75a778b298480d2fc2b306f634";

/**
 * The version string reported by `termaid --version` at `REFERENCE_COMMIT`.
 */
export const REFERENCE_VERSION = "0.12.0";

/**
 * The full `uvx --from` package specification for the pinned git commit.
 */
export const REFERENCE_SPEC = `${DISTRIBUTION} @ git+${REFERENCE_REPO}@${REFERENCE_COMMIT}`;

/** What a spawn runs. */
export const REFERENCE_COMMAND = RUNNER;

/** What must sit in FRONT of the reference's own flags, since the runner is asked for a tool before the tool is asked. */
export const REFERENCE_ARGV: readonly string[] = [
  FROM_FLAG,
  REFERENCE_SPEC,
  COMMAND,
];

/** The whole argv of one call: the runner's prefix, then what the reference itself is being asked. */
export const referenceArgs = (args: readonly string[]): string[] => [...REFERENCE_ARGV, ...args];
