import { exec, execSync } from "child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function runCommand(cmd, cwd) {
    return new Promise((resolve) => {
        exec(cmd, { cwd, timeout: 15_000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
            resolve({ error, stdout: stdout || "", stderr: stderr || "" });
        });
    });
}

export function getGitBranch() {
    try {
        return execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["pipe", "pipe", "pipe"] })
            .toString().trim();
    } catch { return null; }
}

export function getGitStatus() {
    try {
        const out = execSync("git status --porcelain", { stdio: ["pipe", "pipe", "pipe"] })
            .toString().trim();
        if (!out) return "clean";
        const lines = out.split("\n");
        const mod = lines.filter(l => l.startsWith(" M") || l.startsWith("M")).length;
        const add = lines.filter(l => l.startsWith("?")).length;
        const parts = [];
        if (mod) parts.push(`${mod} modified`);
        if (add) parts.push(`${add} untracked`);
        return parts.join("  ") || `${lines.length} changed`;
    } catch { return null; }
}

export function getNodeVersion() {
    return process.version;
}

export function getNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function getDate() {
    const d = new Date();
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export async function checkForUpdate() {
    try {
        const res = await fetch(`https://registry.npmjs.org/cli-atom/latest`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        const data = await res.json();
        return data.version || null;
    } catch {
        return null;
    }
}
