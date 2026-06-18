import { init } from "@heyputer/puter.js/src/init.cjs";
import fs from "fs";
import path from "path";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { exec } from "child_process";

marked.use(markedTerminal());

process.on("unhandledRejection", (err) => { console.error("unhandled rejection:", err); });
process.on("uncaughtException", (err) => { console.error("uncaught exception:", err); });

const t = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    white: "\x1b[97m",
    gray: "\x1b[90m",
    black: "\x1b[30m",
    muted: "\x1b[38;5;244m",
    accent: "\x1b[38;5;255m",
    subtle: "\x1b[38;5;238m",
    violet: "\x1b[38;5;203m",
    violetDim: "\x1b[38;5;160m",
    ok: "\x1b[38;5;114m",
    warn: "\x1b[38;5;179m",
    err: "\x1b[38;5;167m",
    info: "\x1b[38;5;110m",
    bgDark: "\x1b[48;5;234m",
    bgMid: "\x1b[48;5;236m",
};

const IGNORE_DIRS = ["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".cache"];
const IGNORE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2",
    ".ttf", ".eot", ".mp3", ".mp4", ".zip", ".tar", ".gz",
    ".exe", ".dll", ".so", ".lock"];
const MAX_FILE_SIZE = 15_000;
let MODEL = "z-ai/glm-5-turbo";
let MODEL_LABEL = "glm-5-turbo";
const VERSION = "0.2.0";

const MODELS = [
    { id: "z-ai/glm-5-turbo", label: "glm-5-turbo" },
    { id: "openai/gpt-4o", label: "gpt-4o" },
    { id: "openai/gpt-4-turbo", label: "gpt-4-turbo" },
    { id: "meta-llama/llama-3-70b-instruct", label: "llama-3-70b" },
    { id: "mistral-large", label: "mistral-large" }
];

const puter = init(
    ""
);

let conversationHistory = [];
let promptCount = 0;
let filesCreated = 0;
let filesEdited = 0;
const sessionStart = Date.now();
const systemPrompt = `You are an autonomous AI coding agent. You have FULL VISIBILITY of the user's project files (provided below as context).
Analyze the existing code structure before deciding what to do. Be smart: if a file exists, EDIT it. If it doesn't, create it with FILE.

You MUST respond EXCLUSIVELY with a valid JSON object. Do NOT wrap the JSON in any other text, just output the JSON object.
Use the following strict schema. CRITICAL: Ensure all strings inside the JSON are properly escaped (use \\n for newlines, and escape double quotes \\").

{
  "message": "A concise explanation of what you are doing (optional)",
  "filesToCreate": [
    {
      "path": "path/to/new_file.ext",
      "content": "Full content of the new file"
    }
  ],
  "filesToEdit": [
    {
      "path": "path/to/existing_file.ext",
      "search": "exact lines to find in the file",
      "replace": "new lines to put in their place"
    }
  ],
  "filesToDelete": [
    "path/to/file_or_folder"
  ],
  "commandsToRun": [
    "npm test",
    "node script.js"
  ]
}

- Keep "message" concise and normal.
- If you don't need to do an action, leave the array empty \`[]\` or omit it.
- Write compact and efficient code.
- If no file operations are needed, just provide a "message" and leave the arrays empty.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cols() {
    return process.stdout.columns || 80;
}

function rule(char = "─", color = t.violetDim) {
    return `${color}${char.repeat(cols())}${t.reset}`;
}

function pad(str, width) {
    const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
    return str + " ".repeat(Math.max(0, width - visible.length));
}

function elapsed() {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function scanDir(dirPath, prefix = "") {
    let tree = "";
    let files = [];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (IGNORE_DIRS.includes(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                tree += `${prefix}${entry.name}/\n`;
                const sub = scanDir(fullPath, prefix + "  ");
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
                } catch { /* skip unreadable files */ }
            }
        }
    } catch { /* skip unreadable dirs */ }
    return { tree, files };
}


let _contextCache = null;
let _contextSnapshot = null;

function getSnapshot(files) {
    const snap = {};
    for (const f of files) {
        try { snap[f.path] = fs.statSync(f.path).mtimeMs; } catch { snap[f.path] = 0; }
    }
    return snap;
}

function snapshotChanged(files, snap) {
    if (!snap) return true;
    for (const f of files) {
        try {
            if (fs.statSync(f.path).mtimeMs !== snap[f.path]) return true;
        } catch { return true; }
    }
    return Object.keys(snap).length !== files.length;
}

function buildContext() {
    const cwd = process.cwd();
    const { tree, files } = scanDir(cwd);

    if (_contextCache && !snapshotChanged(files, _contextSnapshot)) {
        return _contextCache;
    }

    let ctx = `\n--- PROJECT CONTEXT (${cwd}) ---\n`;
    ctx += `File tree:\n${tree}\n`;
    for (const f of files) {
        const rel = path.relative(cwd, f.path).replace(/\\/g, "/");
        ctx += `--- ${rel} ---\n${f.content}\n--- end ${rel} ---\n\n`;
    }
    ctx += `--- END PROJECT CONTEXT ---\n`;

    _contextCache = ctx;
    _contextSnapshot = getSnapshot(files);
    return ctx;
}

setTimeout(() => buildContext(), 0);

function runCommand(cmd, cwd) {
    return new Promise((resolve) => {
        exec(cmd, { cwd, timeout: 15_000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
            resolve({ error, stdout: stdout || "", stderr: stderr || "" });
        });
    });
}

const SPINNER_FRAMES = ["·", "·", "·", "·", "·", "·", "·", "·", "·", "·"].map(
    (_, i, a) => {
        const bar = a.map((__, j) => (j <= i ? "▪" : "·")).join("");
        return bar;
    }
);
const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(label) {
    let i = 0;
    const timer = setInterval(() => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
            `  ${t.muted}${SPINNER_CHARS[i % SPINNER_CHARS.length]}  ${label}${t.reset}`
        );
        i++;
    }, 80);
    return timer;
}

function stopSpinner(timer, msg) {
    clearInterval(timer);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    if (msg) console.log(msg);
}


function sectionHeader(label) {
    console.log();
    console.log(`${t.violet}${label}${t.reset}`);
    console.log(`${t.violetDim}${"─".repeat(cols())}${t.reset}`);
}

async function showCreatedFile(filePath, content) {
    const lines = content.split("\n");
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    console.log(`  ${t.ok}+${t.reset}  ${t.accent}${relPath}${t.reset}  ${t.muted}${lines.length} lines${t.reset}`);
    await sleep(60);

    const preview = lines.slice(0, 8);
    for (let i = 0; i < preview.length; i++) {
        const num = String(i + 1).padStart(3, " ");
        console.log(`     ${t.subtle}${num}${t.reset}  ${t.dim}${preview[i]}${t.reset}`);
        await sleep(12);
    }
    if (lines.length > 8) {
        console.log(`     ${t.subtle}    ${t.reset}  ${t.muted}... ${lines.length - 8} more lines${t.reset}`);
    }
    console.log();
}

async function showDiff(filePath, searchBlock, replaceBlock) {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    console.log(`  ${t.warn}~${t.reset}  ${t.accent}${relPath}${t.reset}`);
    await sleep(60);

    for (const line of searchBlock.split("\n")) {
        console.log(`     ${t.err}-  ${t.dim}${line}${t.reset}`);
        await sleep(18);
    }
    for (const line of replaceBlock.split("\n")) {
        console.log(`     ${t.ok}+  ${line}${t.reset}`);
        await sleep(18);
    }
    console.log();
}

function printStatus(icon, color, msg) {
    console.log(`  ${color}${icon}${t.reset}  ${msg}`);
}

function askPrompt() {
    console.log();
    console.log(rule());

    const sessionStats = `${filesCreated} created   ${filesEdited} edited`;
    const left = `${t.subtle}${sessionStats}${t.reset}`;
    const right = `${t.muted}${MODEL_LABEL}   ${promptCount} req   ${elapsed()}${t.reset}`;
    const rightVisible = right.replace(/\x1b\[[0-9;]*m/g, "");
    const gap = cols()
        - left.replace(/\x1b\[[0-9;]*m/g, "").length
        - rightVisible.length;
    console.log(left + " ".repeat(Math.max(0, gap)) + right);
    console.log();

    let input = "";

    const BG = "\x1b[48;5;238m";
    const FG = "\x1b[38;5;255m";
    const FGP = "\x1b[38;5;245m";
    const PAD = " ";

    function drawBox(text, isPlaceholder) {
        const currentCols = cols();
        const fg = isPlaceholder ? FGP : FG;
        let displayStr = text;
        const maxLen = Math.max(10, currentCols - PAD.length - 2);
        if (!isPlaceholder && displayStr.length > maxLen) {
            displayStr = "…" + displayStr.slice(displayStr.length - maxLen + 1);
        }
        const content = PAD + displayStr;
        const fill = " ".repeat(Math.max(0, currentCols - content.length));
        const emptyRow = BG + " ".repeat(currentCols) + "\x1b[0m";
        const textRow = BG + fg + content + fill + "\x1b[0m";
        return emptyRow + "\n" + textRow + "\n" + emptyRow + "\n";
    }

    function renderBox() {
        process.stdout.write("\x1b[3A\r" + drawBox(input || "", input.length === 0));
    }

    function onResize() {
        renderBox();
    }
    process.stdout.on("resize", onResize);

    process.stdout.write(drawBox("insert your instruction...", true));
    process.stdout.write("\x1b[?25l");

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function onData(key) {
        if (key === "\u0003") { process.stdout.write("\x1b[?25h"); process.exit(); }
        if (key === "\r" || key === "\n") {
            if (!input.trim()) return;
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            process.stdout.removeListener("resize", onResize);
            process.stdout.write("\x1b[?25h");
            process.stdout.write("\x1b[3A\x1b[2K\x1b[1B\x1b[2K\x1b[1B\x1b[2K\x1b[1A\r");
            handleInput(input);
            return;
        }
        if (key === "\x7f" || key === "\b") {
            input = input.slice(0, -1);
        } else if (key.charCodeAt(0) >= 32) {
            input += key;
        }
        renderBox();
    }

    process.stdin.on("data", onData);
}

async function handleInput(raw) {
    const userPrompt = raw.trim();

    if (!userPrompt) { askPrompt(); return; }

    if (userPrompt.toLowerCase() === "exit" || userPrompt.toLowerCase() === "quit") {
        console.log();
        console.log(`  ${t.muted}session ended   ${filesCreated} created   ${filesEdited} edited   ${elapsed()}${t.reset}`);
        console.log();
        process.exit(0);
        return;
    }

    if (userPrompt.toLowerCase().startsWith("/model")) {
        const parts = userPrompt.split(" ");
        if (parts.length === 1) {
            console.log(`\n  ${t.violet}Available models:${t.reset}`);
            MODELS.forEach((m, i) => console.log(`  ${t.muted}${i + 1}. ${m.label}${t.reset}`));
            console.log(`\n  ${t.dim}Type '/model <number>' or '/model <name>' to switch.${t.reset}\n`);
            askPrompt();
            return;
        }

        const selection = parts[1].toLowerCase();
        const selected = MODELS.find(m => m.label.toLowerCase() === selection) ||
            MODELS.find(m => m.id.toLowerCase() === selection) ||
            MODELS[parseInt(selection) - 1];

        if (selected) {
            MODEL = selected.id;
            MODEL_LABEL = selected.label;
            console.log(`\n  ${t.ok}Model switched to ${t.bold}${MODEL_LABEL}${t.reset}\n`);
        } else {
            console.log(`\n  ${t.err}Model not found. Type '/model' to see the list.${t.reset}\n`);
        }
        askPrompt();
        return;
    }

    promptCount++;

    if (conversationHistory.length > 6) conversationHistory = conversationHistory.slice(-6);

    const projectContext = buildContext();
    let fullPrompt = systemPrompt + "\n" + projectContext + "\n";

    if (conversationHistory.length > 0) {
        fullPrompt += "--- Conversation History ---\n";
        conversationHistory.forEach((msg) => {
            fullPrompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n\n`;
        });
        fullPrompt += "--- End of History ---\n\n";
    }

    fullPrompt += `User prompt: ${userPrompt}`;

    console.log();
    const spinner = startSpinner("thinking");

    try {
        const response = await puter.ai.chat(fullPrompt, { model: MODEL });
        let content = response["message"]["content"];

        let jsonStr = content.trim();
        if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
        else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        let parsed = null;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e1) {
            try {
                const cleanStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                parsed = JSON.parse(cleanStr);
            } catch (e2) {
                try {
                    parsed = eval("(" + jsonStr + ")");
                } catch (e3) {
                    /* plain text response */
                }
            }
        }

        if (!parsed) {
            stopSpinner(spinner, "");
            console.log(`\n${marked(content)}\n`);
            console.log(`  ${t.warn}Note: The model returned malformed JSON that could not be parsed automatically.${t.reset}\n`);
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content });
            askPrompt();
            return;
        }

        const actions = parsed.filesToCreate || [];
        const edits = parsed.filesToEdit || [];
        const deletes = parsed.filesToDelete || [];
        const runs = parsed.commandsToRun || [];
        const message = parsed.message || "";

        const hasFileOps = actions.length > 0 || edits.length > 0 || deletes.length > 0;

        // ── delete files ──────────────────────────────────────────────────────────
        if (deletes.length > 0) {
            stopSpinner(spinner, "");
            sectionHeader("removing files");

            for (const delPath of deletes) {
                try {
                    const stat = await fs.promises.stat(delPath);
                    if (stat.isDirectory()) await fs.promises.rm(delPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                    else await fs.promises.unlink(delPath);
                    const rel = path.relative(process.cwd(), delPath).replace(/\\/g, "/");
                    printStatus("-", t.err, `${t.dim}${rel}${t.reset}`);
                } catch (err) {
                    if (err.code !== "ENOENT") {
                        printStatus("x", t.err, `${delPath}  ${t.muted}${err.message}${t.reset}`);
                    }
                }
            }
        }

        // ── create files ──────────────────────────────────────────────────────────
        if (actions.length > 0) {
            if (deletes.length === 0) stopSpinner(spinner, "");
            sectionHeader("creating files");

            for (const action of actions) {
                try {
                    const dir = path.dirname(action.path);
                    if (dir && dir !== ".") await fs.promises.mkdir(dir, { recursive: true });
                    await fs.promises.writeFile(action.path, action.content);
                    _contextCache = null;
                    await showCreatedFile(action.path, action.content);
                    filesCreated++;
                } catch (err) {
                    printStatus("x", t.err, `${action.path}  ${t.muted}${err.message}${t.reset}`);
                }
            }
        }

        // ── edit files ────────────────────────────────────────────────────────────
        if (edits.length > 0) {
            if (deletes.length === 0 && actions.length === 0) stopSpinner(spinner, "");
            sectionHeader("editing files");

            for (const edit of edits) {
                try {
                    let fileContent = await fs.promises.readFile(edit.path, "utf-8");
                    if (fileContent.includes(edit.search)) {
                        fileContent = fileContent.replace(edit.search, edit.replace);
                        await fs.promises.writeFile(edit.path, fileContent);
                        _contextCache = null;
                        await showDiff(edit.path, edit.search, edit.replace);
                        filesEdited++;
                    } else {
                        printStatus("!", t.warn, `${edit.path}  ${t.muted}search block not found${t.reset}`);
                    }
                } catch (err) {
                    printStatus("x", t.err, `${edit.path}  ${t.muted}${err.message}${t.reset}`);
                }
            }
        }

        if (runs.length > 0) {
            if (!hasFileOps) stopSpinner(spinner, "");
            sectionHeader("running");

            for (const cmd of runs) {
                console.log(`  ${t.muted}$ ${cmd}${t.reset}`);
                const result = await runCommand(cmd, process.cwd());

                if (result.stdout) {
                    result.stdout.split("\n").forEach((l) => console.log(`  ${t.dim}  ${l}${t.reset}`));
                }

                if (result.error || result.stderr) {
                    const errOutput = result.stderr || result.error?.message || "";
                    errOutput.split("\n").forEach((l) => console.log(`  ${t.err}  ${l}${t.reset}`));

                    console.log();
                    console.log(`  ${t.muted}error detected — sending to model for fix${t.reset}`);

                    const fixSpinner = startSpinner("fixing");
                    const fixCtx = systemPrompt + "\n" + buildContext() + "\n\n";
                    const fixMsg = `The command "${cmd}" produced this error:\n${errOutput}\n`
                        + `Fix it by returning a JSON object with the necessary filesToEdit or filesToCreate.`;

                    try {
                        const fixRes = await puter.ai.chat(fixCtx + fixMsg, { model: MODEL });
                        let fixStr = fixRes["message"]["content"].trim();
                        if (fixStr.startsWith("```json")) fixStr = fixStr.slice(7);
                        else if (fixStr.startsWith("```")) fixStr = fixStr.slice(3);
                        if (fixStr.endsWith("```")) fixStr = fixStr.slice(0, -3);

                        const fixParsed = JSON.parse(fixStr.trim());
                        stopSpinner(fixSpinner, "");
                        sectionHeader("applying fix");

                        for (const fm of (fixParsed.filesToCreate || [])) {
                            const dir = path.dirname(fm.path);
                            if (dir && dir !== ".") await fs.promises.mkdir(dir, { recursive: true });
                            await fs.promises.writeFile(fm.path, fm.content);
                            await showCreatedFile(fm.path, fm.content);
                        }

                        for (const em of (fixParsed.filesToEdit || [])) {
                            try {
                                let fc = await fs.promises.readFile(em.path, "utf-8");
                                if (fc.includes(em.search)) {
                                    fc = fc.replace(em.search, em.replace);
                                    await fs.promises.writeFile(em.path, fc);
                                    _contextCache = null;
                                    await showDiff(em.path, em.search, em.replace);
                                }
                            } catch { /* skip */ }
                        }

                        printStatus("", t.ok, "fix applied");
                    } catch (fixErr) {
                        stopSpinner(fixSpinner, "");
                        printStatus("x", t.err, `auto-fix failed  ${t.muted}${fixErr.message || JSON.stringify(fixErr)}${t.reset}`);
                    }
                } else {
                    console.log(`  ${t.ok}  ok${t.reset}`);
                }
            }
        }

        if (hasFileOps || runs.length > 0) {
            console.log();
            if (message) {
                console.log(`  ${t.muted}${message}${t.reset}`);
            }
            const summary = [
                ...actions.map((a) => `created ${path.relative(process.cwd(), a.path).replace(/\\/g, "/")}`),
                ...edits.map((e) => `edited ${path.relative(process.cwd(), e.path).replace(/\\/g, "/")}`),
                ...deletes.map((d) => `deleted ${d}`),
            ].join(", ");
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content: `[${summary}] ${message}` });
        } else if (message) {
            stopSpinner(spinner);
            console.log(`\n${marked(message)}\n`);
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content: message });
        } else {
            stopSpinner(spinner);
        }

    } catch (err) {
        stopSpinner(spinner, `  ${t.err}error  ${t.muted}${err.message || JSON.stringify(err)}${t.reset}`);
    } finally {
        askPrompt();
    }
}


function getGitBranch() {
    try {
        return require("child_process")
            .execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["pipe", "pipe", "pipe"] })
            .toString().trim();
    } catch { return null; }
}

function getGitStatus() {
    try {
        const out = require("child_process")
            .execSync("git status --porcelain", { stdio: ["pipe", "pipe", "pipe"] })
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

function getNodeVersion() {
    return process.version;
}

function getNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getDate() {
    const d = new Date();
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}


async function start() {
    console.clear();

    const w = cols();
    const branch = getGitBranch();
    const status = getGitStatus();
    const cwd = process.cwd();
    const node = getNodeVersion();
    const now = getNow();
    const date = getDate();

    console.log();
    console.log(rule("─"));
    console.log();

    const titleLeft = `${t.violet}${t.bold}ATOM${t.reset}  ${t.muted}autonomous coding agent${t.reset}`;
    const titleRight = `${t.violetDim}v${VERSION}${t.reset}`;
    const titleRightVis = `v${VERSION}`;
    const titleGap = w - "ATOM  autonomous coding agent".length - titleRightVis.length;
    console.log(titleLeft + " ".repeat(Math.max(0, titleGap)) + titleRight);

    console.log();

    const rows = [
        [`model`, MODEL_LABEL],
        [`node`, node],
        [`cwd`, cwd.length > 48 ? "..." + cwd.slice(-45) : cwd],
        branch ? [`branch`, branch] : null,
        branch && status ? [`status`, status] : null,
        [`date`, date],
        [`time`, now],
    ].filter(Boolean);

    for (const [label, value] of rows) {
        const l = `${t.violetDim}${label.padEnd(10)}${t.reset}`;
        const v = `${t.muted}${value}${t.reset}`;
        console.log(l + v);
    }

    console.log();
    console.log(rule("─"));
    console.log();
    console.log(`${t.violetDim}ready${t.reset}`);

    askPrompt();
}

start();