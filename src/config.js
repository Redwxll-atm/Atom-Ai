import fs from "fs";
import os from "os";
import path from "path";
import { state } from "./state.js";

const CONFIG_DIR = path.join(os.homedir(), ".atom-cli");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
        return {};
    }
}

export function setConfig(data) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const current = getConfig();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...data }, null, 2));
}

export function promptInput(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.setEncoding("utf8");
        process.stdin.once("data", (data) => {
            resolve(data.trim());
        });
    });
}

// Initialize state config
state.config = getConfig();
