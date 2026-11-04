// `--print-config`: a ready-to-paste MCP client entry that launches the published
// package through npx. Pure builder + PATH lookup; the CLI wiring lives in index.ts.

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter as posixDelimiter, dirname as posixDirname, isAbsolute as posixIsAbsolute, join as posixJoin } from "node:path";
import { win32 } from "node:path";

export const PACKAGE_NAME = "@vernikr/biblio-mcp";

export interface LauncherConfigInput {
  /** Absolute path of the node binary running biblio-mcp. */
  execPath: string;
  /** Command to start npx: an absolute path when it was found, otherwise "npx". */
  npxPath: string;
  platform: NodeJS.Platform;
}

export interface LauncherConfig {
  mcpServers: {
    biblio: {
      command: string;
      args: string[];
      env: { PATH: string };
    };
  };
}

function pathOps(platform: NodeJS.Platform) {
  return platform === "win32"
    ? { dirname: win32.dirname, isAbsolute: win32.isAbsolute, delimiter: ";" }
    : { dirname: posixDirname, isAbsolute: posixIsAbsolute, delimiter: posixDelimiter };
}

/**
 * Build the MCP entry. The PATH it carries lets a GUI-started client find both
 * npx and the node that npx runs on, which a GUI launch does not inherit
 * from the user's shell.
 */
export function buildLauncherConfig(input: LauncherConfigInput): LauncherConfig {
  const ops = pathOps(input.platform);
  const dirs: string[] = [ops.dirname(input.execPath)];
  if (ops.isAbsolute(input.npxPath)) dirs.push(ops.dirname(input.npxPath));
  if (input.platform !== "win32") dirs.push("/usr/bin", "/bin");
  const unique = [...new Set(dirs)];
  return {
    mcpServers: {
      biblio: {
        command: input.npxPath,
        // npx resolves @latest on each start, so the client always gets the newest release.
        args: ["--yes", `${PACKAGE_NAME}@latest`],
        env: { PATH: unique.join(ops.delimiter) },
      },
    },
  };
}

/**
 * Directory of the node binary to put on PATH. Version managers such as fnm run
 * node through a per-shell symlink under `fnm_multishells`; that directory is
 * deleted when the shell exits, so the real install directory is used instead.
 */
export function stableExecPath(
  execPath: string,
  realpath: (p: string) => string = realpathSync
): string {
  try {
    return realpath(execPath);
  } catch {
    return execPath;
  }
}

/** A warning when a path is expected to disappear, or undefined when it looks stable. */
export function ephemeralPathWarning(file: string): string | undefined {
  if (/[\\/]fnm_multishells[\\/]/.test(file)) {
    return `${file} is a per-shell location that is removed when its terminal closes; use the stable install path instead`;
  }
  if (/^(\/tmp\/|\/var\/folders\/|[A-Za-z]:\\\\.*\\\\Temp\\\\)/.test(file)) {
    return `${file} is in a temporary directory and may not exist later`;
  }
  return undefined;
}

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== "win32") accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find `name` on the given PATH, returning the absolute path, or undefined.
 * On Windows npx is usually a `.cmd` shim, so those extensions are tried too.
 */
export function findOnPath(
  name: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (!pathValue) return undefined;
  const ops = pathOps(platform);
  const exts = platform === "win32" ? ["", ".cmd", ".exe"] : [""];
  const join = platform === "win32" ? win32.join : posixJoin;
  for (const dir of pathValue.split(ops.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return undefined;
}
