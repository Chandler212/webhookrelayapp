import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(root, "SKILL.md");
const target = resolve(root, "public/skill.md");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
