import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const projectDirectory = resolve(appDirectory, "..");
const webDirectory = resolve(appDirectory, "www");
const files = ["index.html", "forms.html", "solutions.html", "main.js", "style.css"];

await mkdir(webDirectory, { recursive: true });
await Promise.all(files.map((file) =>
    copyFile(resolve(projectDirectory, file), resolve(webDirectory, file))
));
console.log(`Copied ${files.length} web assets into the Android app.`);
