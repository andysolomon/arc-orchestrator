import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, parse } from "node:path";

export function validateReadRoots(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error("read_roots must contain 1-8 absolute directory paths");
  }
  const roots = value.map((path: unknown) => {
    if (
      typeof path !== "string" ||
      !isAbsolute(path) ||
      /[*?\[\]{}\x00-\x1f]/.test(path)
    ) {
      throw new Error(
        "read_roots must contain literal absolute directory paths",
      );
    }
    const root = realpathSync(path);
    if (
      root === parse(root).root ||
      root === realpathSync(homedir()) ||
      !statSync(root).isDirectory()
    ) {
      throw new Error(
        "read_roots must name specific directories, not a filesystem root or home",
      );
    }
    if (/[*?\[\]{}\x00-\x1f]/.test(root)) {
      throw new Error("read_roots must resolve to literal directory paths");
    }
    return root;
  });
  return [...new Set(roots)];
}
