// The manifest facts the runtime repeats instead of hard-coding.

import { createRequire } from "node:module";

export interface Manifest {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

/** Another project's manifest is worse than none: an unknown version beats a wrong one. */
const UNKNOWN: Manifest = { name: "biblio-mcp", version: "0.0.0-unknown", dependencies: {} };

function load(): Manifest {
  try {
    const pkg = createRequire(import.meta.url)("../package.json") as Partial<Manifest>;
    if (pkg.name !== "@vernikr/biblio-mcp") return UNKNOWN;
    return {
      name: pkg.name,
      version: pkg.version ?? UNKNOWN.version,
      dependencies: pkg.dependencies ?? {},
    };
  } catch {
    return UNKNOWN;
  }
}

export const MANIFEST: Manifest = load();

/** `name@version` for a dependency this package pins, bare `name` when it does not. */
export function pinnedDependency(name: string): string {
  const version = MANIFEST.dependencies[name];
  return version ? `${name}@${version}` : name;
}
