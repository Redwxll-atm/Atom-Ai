import fs from "fs";
import path from "path";

const IGNORE_DIRS = ["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".cache"];
const IGNORE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2",
    ".ttf", ".eot", ".mp3", ".mp4", ".zip", ".tar", ".gz",
    ".exe", ".dll", ".so", ".lock"];
const MAX_FILE_SIZE = 15_000;
const MAX_FILES = 50;
const MAX_CONTEXT_CHARS = 60_000;

export let _contextCache = null;
export let _contextSnapshot = null;

export function invalidateContext() {
    _contextCache = null;
}

export function scanDir(dirPath, prefix = "", _count = { n: 0 }) {
    let tree = "";
    let files = [];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (_count.n >= MAX_FILES) break;
            if (IGNORE_DIRS.includes(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                tree += `${prefix}${entry.name}/\n`;
                const sub = scanDir(fullPath, prefix + "  ", _count);
                tree += sub.tree;
                files.push(...sub.files);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (IGNORE_EXTS.includes(ext)) continue;
                tree += `${prefix}${entry.name}\n`;
                try {
                    const stat = fs.statSync(fullPath);
                    const content = stat.size <= MAX_FILE_SIZE
                        ? fs.readFileSync(fullPath, "utf-8")
                        : "[file too large — truncated]";
                    files.push({ path: fullPath.replace(/\\/g, "/"), content });
                    _count.n++;
                } catch { /* skip unreadable files */ }
            }
        }
    } catch { /* skip unreadable dirs */ }
    return { tree, files };
}

export function getSnapshot(files) {
    const snap = {};
    for (const f of files) {
        try { snap[f.path] = fs.statSync(f.path).mtimeMs; } catch { snap[f.path] = 0; }
    }
    return snap;
}

export function snapshotChanged(files, snap) {
    if (!snap) return true;
    for (const f of files) {
        try {
            if (fs.statSync(f.path).mtimeMs !== snap[f.path]) return true;
        } catch { return true; }
    }
    return Object.keys(snap).length !== files.length;
}

export function buildContext() {
    const cwd = process.cwd();
    const { tree, files } = scanDir(cwd);

    if (_contextCache && !snapshotChanged(files, _contextSnapshot)) {
        return _contextCache;
    }

    let ctx = `\n--- PROJECT CONTEXT (${cwd}) ---\n`;
    ctx += `File tree:\n${tree}\n`;
    let totalChars = ctx.length;
    for (const f of files) {
        const rel = path.relative(cwd, f.path).replace(/\\/g, "/");
        const block = `--- ${rel} ---\n${f.content}\n--- end ${rel} ---\n\n`;
        if (totalChars + block.length > MAX_CONTEXT_CHARS) {
            ctx += `[context limit reached — ${files.length} files total, showing partial]\n`;
            break;
        }
        ctx += block;
        totalChars += block.length;
    }
    ctx += `--- END PROJECT CONTEXT ---\n`;

    _contextCache = ctx;
    _contextSnapshot = getSnapshot(files);
    return ctx;
}
