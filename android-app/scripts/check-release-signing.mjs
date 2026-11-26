import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

const requiredVariables = [
    "ANDROID_UPLOAD_KEYSTORE",
    "ANDROID_UPLOAD_STORE_PASSWORD",
    "ANDROID_UPLOAD_KEY_ALIAS",
    "ANDROID_UPLOAD_KEY_PASSWORD"
];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

if (missingVariables.length > 0) {
    console.error(`Missing release signing environment variable(s): ${missingVariables.join(", ")}`);
    process.exit(1);
}

if (!isAbsolute(process.env.ANDROID_UPLOAD_KEYSTORE)) {
    console.error("ANDROID_UPLOAD_KEYSTORE must be an absolute path.");
    process.exit(1);
}

if (!existsSync(process.env.ANDROID_UPLOAD_KEYSTORE)) {
    console.error("The keystore file specified by ANDROID_UPLOAD_KEYSTORE does not exist.");
    process.exit(1);
}
