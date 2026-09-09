import { promises as fs } from "node:fs";
import path from "node:path";
import { tool } from "@openrouter/agent";
import { z } from "zod";

/**
 * Filesystem access, scoped to a single root directory. Every path is resolved
 * and checked to be inside the root before any I/O happens, so the agent can
 * never read outside the tree it was pointed at.
 *
 * Exported on its own (not just as agent tools) so it can be unit-tested and
 * reused without going through the model.
 */
export function createFileReader(rootDir: string) {
  const root = path.resolve(rootDir);

  function resolveInside(relativePath: string): string {
    const abs = path.resolve(root, relativePath);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Path "${relativePath}" escapes the review root`);
    }
    return abs;
  }

  const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)/;

  return {
    root,

    async listFiles(dir = "."): Promise<string[]> {
      const target = resolveInside(dir);
      const entries = await fs.readdir(target, {
        withFileTypes: true,
        recursive: true,
      });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path.relative(root, path.join(entry.parentPath, entry.name)),
        )
        .filter((rel) => !IGNORED.test(rel))
        .sort();
    },

    async readFile(file: string): Promise<{ file: string; content: string }> {
      const target = resolveInside(file);
      const raw = await fs.readFile(target, "utf8");
      const numbered = raw
        .split("\n")
        .map((lineText, index) => `${index + 1}\t${lineText}`)
        .join("\n");
      return { file, content: numbered };
    },
  };
}

export type FileReader = ReturnType<typeof createFileReader>;

/**
 * The agent's toolset: discover files, then read them. Returned as a readonly
 * tuple so `callModel`'s generics can infer tool names for `stopWhen` etc.
 */
export function createFileTools(rootDir: string) {
  const files = createFileReader(rootDir);

  const listFiles = tool({
    name: "list_files",
    description:
      "Recursively list files under a directory (relative to the review root). " +
      "Call this first to discover neighbouring modules, tests and configs.",
    inputSchema: z.object({
      dir: z
        .string()
        .default(".")
        .describe(
          "Directory relative to the review root; defaults to the root",
        ),
    }),
    execute: ({ dir }) => files.listFiles(dir),
  });

  const readFile = tool({
    name: "read_file",
    description:
      "Read a UTF-8 text file relative to the review root. " +
      "Returns the file content prefixed with 1-indexed line numbers.",
    inputSchema: z.object({
      file: z.string().describe("File path relative to the review root"),
    }),
    execute: ({ file }) => files.readFile(file),
  });

  return [listFiles, readFile] as const;
}
