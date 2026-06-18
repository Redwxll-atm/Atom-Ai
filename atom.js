#!/usr/bin/env node
import { init } from "@heyputer/puter.js/src/init.cjs";
import fs from "fs";
import os from "os";
import path from "path";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { exec } from "child_process";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

marked.use(markedTerminal());

process.on("unhandledRejection", (err) => { console.error("unhandled rejection:", err); });
process.on("uncaughtException", (err) => { console.error("uncaught exception:", err); });

// ── THEME ────────────────────────────────────────────────────────────────────
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
    violet: "\x1b[38;5;141m",
    violetDim: "\x1b[38;5;60m",
    ok: "\x1b[38;5;114m",
    warn: "\x1b[38;5;179m",
    err: "\x1b[38;5;174m",
    info: "\x1b[38;5;110m",
    bgDark: "\x1b[48;5;234m",
    bgMid: "\x1b[48;5;236m",
};

const IGNORE_DIRS = ["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".cache"];
const IGNORE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2",
    ".ttf", ".eot", ".mp3", ".mp4", ".zip", ".tar", ".gz",
    ".exe", ".dll", ".so", ".lock"];
const MAX_FILE_SIZE = 15_000;

const MAX_FILES = 15;
const MAX_CONTEXT_CHARS = 20_000;

let MODEL = "z-ai/glm-5.2";
let MODEL_LABEL = "glm-5.2";
const VERSION = _require("./package.json").version;

const MODELS = [
    // Modèle interne Puter (Gratuit)
    { id: "z-ai/glm-5-turbo", label: "glm-5-turbo" },

    // Modèles OpenAI (Très stables via Puter)
    { id: "gpt-4o", label: "gpt-4o" },
    { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    { id: "gpt-4-turbo", label: "gpt-4-turbo" },
    { id: "gpt-3.5-turbo", label: "gpt-3.5-turbo" }
];

// ─── CONFIG MANAGEMENT ───────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".atom-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function getConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); }
    catch { return {}; }
}

function setConfig(data) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const current = getConfig();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...data }, null, 2));
}

function promptInput(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.setEncoding("utf8");
        process.stdin.once("data", (data) => resolve(data.trim()));
    });
}

// ─── CLI COMMANDS ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === "login") {
    console.log(`\n  ${t.violet}${t.bold}ATOM${t.reset}  ${t.muted}login${t.reset}\n`);
    console.log(`  ${t.muted}Go to ${t.accent}https://puter.com${t.muted} and generate an API token.${t.reset}\n`);
    const key = await promptInput(`  ${t.violetDim}Paste your API key: ${t.reset}`);
    if (!key) {
        console.log(`\n  ${t.err}No key provided. Aborting.${t.reset}\n`);
        process.exit(1);
    }
    setConfig({ apiKey: key });
    console.log(`\n  ${t.ok}✓ API key saved to ${t.dim}${CONFIG_FILE}${t.reset}`);
    console.log(`  ${t.muted}You can now run ${t.accent}atom${t.muted} to start coding!${t.reset}\n`);
    process.exit(0);
}

if (args[0] === "logout") {
    try { fs.unlinkSync(CONFIG_FILE); } catch { }
    console.log(`\n  ${t.ok}✓ Logged out. API key removed.${t.reset}\n`);
    process.exit(0);
}

// ─── PUTER INIT ──────────────────────────────────────────────────────────────
let config = getConfig();
if (!config.apiKey) {
    console.log(`\n  ${t.err}✗ No API key found.${t.reset}`);
    console.log(`  ${t.muted}Run ${t.accent}atom login${t.muted} to authenticate.${t.reset}\n`);
    process.exit(1);
}

let puter = init(config.apiKey);

let conversationHistory = [];
let promptCount = 0;
let filesCreated = 0;
let filesEdited = 0;
const sessionStart = Date.now();

const systemPrompt = `You are an autonomous AI coding agent with FULL VISIBILITY of the user's project files.

# MISSION
Analyze the existing codebase, understand its conventions, then make precise, minimal, and correct changes to fulfill the user's request.

# CORE PRINCIPLES
1. **Read before write.** Always analyze existing structure, imports, naming conventions, and patterns before modifying anything.
2. **Edit over create.** If a file already exists, EDIT it. Only create files that are genuinely new.
3. **Always use folders.** When creating new files, NEVER place them directly in the project root. ALWAYS create a dedicated, logically named folder (module/directory) and put the new files inside it. Group related code logically into these subdirectories.
4. **Minimal diff.** Change only what is necessary. Preserve existing style, indentation, and formatting.
5. **Atomic edits.** The "search" string must be unique enough to match exactly ONE location. Include surrounding context lines if needed to disambiguate.
6. **No placeholders.** Never use "// ... rest of code", "// existing code", or "/* unchanged */". Always provide complete, runnable content.
7. **Strict escaping.** All strings inside the JSON must be properly escaped (\\n, \\t, \\", \\\\, etc.). Pay special attention to backticks, template literals, and regex.

# OUTPUT FORMAT
You MUST respond EXCLUSIVELY with a single valid JSON object. 
NO markdown fences, NO commentary before or after, NO trailing text, NO trailing commas.

Schema:
{
  "message": "Concise summary of what you did and why (optional)",
  "filesToCreate": [
    { "path": "folder_name/sub_folder/new_file.ext", "content": "Full file content" }
  ],
  "filesToEdit": [
    { "path": "existing_folder/existing_file.ext", "search": "Exact lines to locate", "replace": "New lines to substitute" }
  ],
  "filesToDelete": [ "folder_name/file_or_folder" ],
  "commandsToRun": [ "run_native_test_or_build_command" ]
}

Rules:
- Omit unused arrays or leave them as [].
- Paths are relative to the project root, use forward slashes, and MUST always include a parent folder. Never output a path with just a filename (e.g., NEVER just "script.js", always "utils/script.js").
- "search" must match existing content byte-for-byte (whitespace and indentation included).
- One file may appear in multiple edit entries if several distinct changes are needed.
- "commandsToRun": Dynamically detect the project's language and ecosystem from its config files (e.g., package.json, requirements.txt, Cargo.toml, go.mod, pom.xml, composer.json, Makefile, CMakeLists.txt, etc.). Run the standard verification commands for that specific ecosystem (e.g., tests, build, lint). NEVER include destructive commands (like rm -rf, dropdb, format, etc.).

# CODING STANDARDS
- Match the project's existing language version, framework, and conventions.
- Prefer standard libraries over new dependencies. If a new dependency is required, mention it in "message".
- Write clean, typed (where applicable), readable, and testable code.
- Keep functions small and focused. No dead code, no commented-out blocks.
- Handle errors gracefully. Never swallow exceptions silently.
- Respect SOLID principles and the project's architectural layering.

# CONSTRAINTS
- Never invent file paths or assume content you cannot see.
- Never modify lockfiles, .env, or CI secrets unless explicitly asked.
- If the request is ambiguous, make the most reasonable assumption and explain it briefly in "message".
- If the request is impossible or unsafe, return an empty JSON with an explanation in "message".`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cols() { return process.stdout.columns || 80; }
function rule(char = "─", color = t.violetDim) { return `${color}${char.repeat(cols())}${t.reset}`; }
function elapsed() {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── FILE SCANNER ────────────────────────────────────────────────────────────
function scanDir(dirPath, prefix = "", _count = { n: 0 }) {
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
                    const content = stat.size <= MAX_FILE_SIZE ? fs.readFileSync(fullPath, "utf-8") : "[file too large]";
                    files.push({ path: fullPath.replace(/\\/g, "/"), content });
                    _count.n++;
                } catch { /* skip */ }
            }
        }
    } catch { /* skip */ }
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
        try { if (fs.statSync(f.path).mtimeMs !== snap[f.path]) return true; }
        catch { return true; }
    }
    return Object.keys(snap).length !== files.length;
}

function buildContext(userPrompt = "") {
    const cwd = process.cwd();
    const { tree, files } = scanDir(cwd);
    const unchanged = !snapshotChanged(files, _contextSnapshot);

    let ctx = `\n--- PROJECT CONTEXT (${cwd}) ---\nFile tree:\n${tree}\n`;

    if (unchanged && _contextCache) {
        ctx += `[Files unchanged since last request — use file tree above]\n--- END PROJECT CONTEXT ---\n`;
        return ctx;
    }

    const keywords = userPrompt.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    let totalChars = ctx.length;
    let included = 0;

    const sorted = [...files].sort((a, b) => {
        const relA = path.relative(cwd, a.path).toLowerCase();
        const relB = path.relative(cwd, b.path).toLowerCase();
        const scoreA = keywords.filter(k => relA.includes(k)).length;
        const scoreB = keywords.filter(k => relB.includes(k)).length;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.content.length - b.content.length;
    });

    for (const f of sorted) {
        if (included >= MAX_FILES) break;
        const rel = path.relative(cwd, f.path).replace(/\\/g, "/");
        const block = `--- ${rel} ---\n${f.content}\n--- end ${rel} ---\n\n`;
        if (totalChars + block.length > MAX_CONTEXT_CHARS) {
            ctx += `[context limit reached — ${files.length} files total, showing partial]\n`;
            break;
        }
        ctx += block;
        totalChars += block.length;
        included++;
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

// ─── UI COMPONENTS ───────────────────────────────────────────────────────────
const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(label) {
    let i = 0;
    const timer = setInterval(() => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`  ${t.violet}${SPINNER_CHARS[i % SPINNER_CHARS.length]}${t.reset}  ${t.muted}${label}${t.reset}`);
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
    console.log(`\n  ${t.violet}${t.bold}${label.toUpperCase()}${t.reset}`);
    console.log(`  ${t.violetDim}${"─".repeat(4)}${t.reset}`);
}

async function showCreatedFile(filePath, content) {
    const lines = content.split("\n");
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    console.log(`  ${t.ok}✓${t.reset}  ${t.bold}${relPath}${t.reset}  ${t.muted}(${lines.length} lines)${t.reset}`);

    const preview = lines.slice(0, 6);
    for (let i = 0; i < preview.length; i++) {
        const num = String(i + 1).padStart(3, " ");
        console.log(`     ${t.subtle}${num}${t.reset}  ${t.dim}${preview[i]}${t.reset}`);
        await sleep(10);
    }
    if (lines.length > 6) {
        console.log(`     ${t.subtle}   ...${t.reset}  ${t.muted}${lines.length - 6} more lines${t.reset}`);
    }
    console.log();
}

async function showDiff(filePath, searchBlock, replaceBlock) {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    console.log(`  ${t.warn}~${t.reset}  ${t.bold}${relPath}${t.reset}`);

    for (const line of searchBlock.split("\n")) {
        console.log(`     ${t.err}- ${t.dim}${line}${t.reset}`);
        await sleep(15);
    }
    for (const line of replaceBlock.split("\n")) {
        console.log(`     ${t.ok}+ ${line}${t.reset}`);
        await sleep(15);
    }
    console.log();
}

function printStatus(icon, color, msg) {
    console.log(`  ${color}${icon}${t.reset}  ${msg}`);
}

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
const SLASH_COMMANDS = [
    { name: "help", desc: "Show all available commands" },
    { name: "model", desc: "List or switch AI model" },
    { name: "key", desc: "View your current API key" },
    { name: "login", desc: "Set a new API key" },
    { name: "logout", desc: "Remove your API key" },
    { name: "exit", desc: "Exit the CLI" },
];

// ─── INTERACTIVE PROMPT (FIXED & ROBUST) ─────────────────────────────────────
// ─── INTERACTIVE PROMPT (FIXED & ROBUST) ─────────────────────────────────────
function askPrompt() {
    const sessionStats = `${t.ok}${filesCreated}${t.reset} created   ${t.warn}${filesEdited}${t.reset} edited`;
    const left = `\n  ${t.subtle}${sessionStats}${t.reset}`;
    const right = `${t.muted}${MODEL_LABEL}   ${promptCount} req   ${elapsed()}${t.reset}`;
    const rightVisible = right.replace(/\x1b\[[0-9;]*m/g, "");
    const gap = cols() - left.replace(/\x1b\[[0-9;]*m/g, "").length - rightVisible.length;
    console.log(left + " ".repeat(Math.max(0, gap)) + right);

    let input = "";
    let menuActive = false;
    let menuIndex = 0;
    let menuItems = [];
    let lastMenuLines = 0;
    let lastVisibleLen = 0;

    function clearPromptAndMenu() {
        // 1. Effacer le menu s'il existe
        if (lastMenuLines > 0) {
            for (let i = 0; i < lastMenuLines; i++) {
                process.stdout.write("\x1b[1B\x1b[2K"); // Descend et efface
            }
            for (let i = 0; i < lastMenuLines; i++) {
                process.stdout.write("\x1b[1A"); // Remonte
            }
            lastMenuLines = 0;
        }

        // 2. Effacer le prompt (gère le retour à la ligne automatique)
        const linesToClear = Math.max(0, Math.floor((lastVisibleLen - 1) / cols()));
        process.stdout.write("\x1b[2K\r"); // Efface la ligne actuelle
        for (let i = 0; i < linesToClear; i++) {
            process.stdout.write("\x1b[1A\x1b[2K\r"); // Monte d'une ligne et efface
        }
    }

    function drawPrompt() {
        clearPromptAndMenu();

        const prefix = `  ${t.violet}❯${t.reset} `;
        const visiblePrefixLen = 4;
        let baseText = "";
        let currentVisibleLen = 0;

        if (input.length === 0) {
            baseText = `${t.muted}Insert your instruction... (type / for commands)${t.reset}`;
            currentVisibleLen = visiblePrefixLen + "Insert your instruction... (type / for commands)".length;
        } else {
            baseText = `${t.accent}${input}${t.reset}`;
            currentVisibleLen = visiblePrefixLen + input.length;
        }

        process.stdout.write(prefix + baseText);
        lastVisibleLen = currentVisibleLen;

        let currentMenuLines = 0;
        if (menuActive) {
            const query = input.slice(1).toLowerCase();
            menuItems = SLASH_COMMANDS.filter(c => c.name.startsWith(query));
            if (menuIndex >= menuItems.length) menuIndex = 0;

            for (let i = 0; i < menuItems.length; i++) {
                const item = menuItems[i];
                const isSelected = i === menuIndex;
                const namePad = ("/" + item.name).padEnd(12);
                process.stdout.write(`\r\n`); // S'assure d'aller à la ligne proprement
                if (isSelected) {
                    process.stdout.write(`  ${t.violet}${t.bold}❯ ${namePad}${t.reset} ${t.accent}${item.desc}${t.reset}`);
                } else {
                    process.stdout.write(`    ${t.violetDim}${namePad}${t.reset} ${t.muted}${item.desc}${t.reset}`);
                }
                currentMenuLines++;
            }
        }

        // Repositionner le curseur si le menu est ouvert
        if (currentMenuLines > 0) {
            for (let i = 0; i < currentMenuLines; i++) {
                process.stdout.write("\x1b[1A"); // Remonte à la ligne du prompt
            }
            const cursorCol = (currentVisibleLen % cols()) || cols();
            process.stdout.write(`\x1b[${cursorCol}G`); // Définit la colonne exacte
        }

        lastMenuLines = currentMenuLines;
    }

    function onResize() { drawPrompt(); }
    process.stdout.on("resize", onResize);

    process.stdout.write("\x1b[?25h");
    drawPrompt();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function cleanup() {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.removeListener("resize", onResize);
    }

    function submitInput(value) {
        clearPromptAndMenu();
        console.log(`  ${t.violet}❯${t.reset} ${t.accent}${value}${t.reset}`);
        handleInput(value);
    }

    function onData(key) {
        if (key === "\u0003") { process.exit(); }

        if (key === "\x1b[A") {
            if (menuActive && menuItems.length > 0) {
                menuIndex = (menuIndex - 1 + menuItems.length) % menuItems.length;
                drawPrompt();
            }
            return;
        }

        if (key === "\x1b[B") {
            if (menuActive && menuItems.length > 0) {
                menuIndex = (menuIndex + 1) % menuItems.length;
                drawPrompt();
            }
            return;
        }

        if (key === "\t") {
            if (menuActive && menuItems.length > 0) {
                input = "/" + menuItems[menuIndex].name;
                drawPrompt();
            }
            return;
        }

        if (key === "\r" || key === "\n") {
            if (menuActive && menuItems.length > 0) {
                input = "/" + menuItems[menuIndex].name;
            }
            if (!input.trim()) return;
            cleanup();
            submitInput(input);
            return;
        }

        if (key === "\x1b") {
            if (menuActive) {
                menuActive = false;
                drawPrompt();
            }
            return;
        }

        if (key === "\x7f" || key === "\b") {
            if (input.length > 0) {
                input = input.slice(0, -1);
                menuActive = input.startsWith("/");
                drawPrompt();
            }
            return;
        }

        if (key.charCodeAt(0) >= 32) {
            input += key;
            menuActive = input.startsWith("/");
            menuIndex = 0;
            drawPrompt();
        }
    }

    process.stdin.on("data", onData);
}

// ─── INPUT HANDLER ───────────────────────────────────────────────────────────
async function handleInput(raw) {
    const userPrompt = raw.trim();

    if (!userPrompt) { askPrompt(); return; }

    if (userPrompt.toLowerCase() === "exit" || userPrompt.toLowerCase() === "quit") {
        console.log(`\n  ${t.muted}Session ended   ${filesCreated} created   ${filesEdited} edited   ${elapsed()}${t.reset}\n`);
        process.exit(0);
        return;
    }

    if (userPrompt.toLowerCase() === "/help") {
        console.log(`\n  ${t.violet}${t.bold}Available commands${t.reset}`);
        SLASH_COMMANDS.forEach(c => {
            console.log(`  ${t.violetDim}/${c.name.padEnd(10)}${t.reset} ${t.muted}${c.desc}${t.reset}`);
        });
        console.log();
        askPrompt();
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
            console.log(`\n  ${t.ok}✓ Model switched to ${t.bold}${MODEL_LABEL}${t.reset}\n`);
        } else {
            console.log(`\n  ${t.err}✗ Model not found. Type '/model' to see the list.${t.reset}\n`);
        }
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase() === "/key") {
        const masked = config.apiKey ? config.apiKey.slice(0, 10) + "..." + config.apiKey.slice(-6) : "none";
        console.log(`\n  ${t.violet}API Key${t.reset}\n  ${t.muted}current: ${masked}${t.reset}\n`);
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase() === "/logout") {
        try { fs.unlinkSync(CONFIG_FILE); } catch { }
        config.apiKey = null;
        console.log(`\n  ${t.ok}✓ Logged out. API key removed.${t.reset}\n`);
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase() === "/login") {
        console.log(`\n  ${t.violet}${t.bold}Login${t.reset}`);
        process.stdin.setRawMode(false);
        process.stdin.resume();
        const key = await promptInput(`  ${t.violetDim}Paste your API key: ${t.reset}`);

        if (!key) {
            console.log(`\n  ${t.err}✗ No key provided.${t.reset}\n`);
            askPrompt();
            return;
        }

        setConfig({ apiKey: key });
        config.apiKey = key;
        puter = init(key);
        console.log(`\n  ${t.ok}✓ API key saved and applied!${t.reset}\n`);
        askPrompt();
        return;
    }

    promptCount++;

    if (conversationHistory.length > 4) {
        const old = conversationHistory.slice(0, -2);
        const summary = old.map(m =>
            `${m.role === "user" ? "U" : "A"}: ${m.content.slice(0, 120)}${m.content.length > 120 ? "…" : ""}`
        ).join("\n");
        conversationHistory = [
            { role: "user", content: `[Earlier conversation summary:\n${summary}]` },
            ...conversationHistory.slice(-2)
        ];
    }

    const projectContext = buildContext(userPrompt);
    let fullPrompt = systemPrompt + "\n" + projectContext + "\n";

    if (conversationHistory.length > 0) {
        fullPrompt += "--- Conversation History ---\n";
        conversationHistory.forEach((msg) => {
            fullPrompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n\n`;
        });
        fullPrompt += "--- End of History ---\n\n";
    }

    fullPrompt += `User prompt: ${userPrompt}`;

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
                try { parsed = eval("(" + jsonStr + ")"); } catch (e3) { /* plain text */ }
            }
        }

        if (!parsed) {
            stopSpinner(spinner, "");
            console.log(`\n${marked(content)}\n`);
            console.log(`  ${t.warn}Note: The model returned malformed JSON.${t.reset}\n`);
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content });
            // FIX: Removed askPrompt() here to prevent multiple listeners from being registered.
            // The finally block below will handle calling askPrompt().
            return;
        }

        const actions = parsed.filesToCreate || [];
        const edits = parsed.filesToEdit || [];
        const deletes = parsed.filesToDelete || [];
        const runs = parsed.commandsToRun || [];
        const message = parsed.message || "";

        const hasFileOps = actions.length > 0 || edits.length > 0 || deletes.length > 0;

        if (deletes.length > 0) {
            stopSpinner(spinner, "");
            sectionHeader("removing files");
            for (const delPath of deletes) {
                try {
                    const stat = await fs.promises.stat(delPath);
                    if (stat.isDirectory()) await fs.promises.rm(delPath, { recursive: true, force: true });
                    else await fs.promises.unlink(delPath);
                    const rel = path.relative(process.cwd(), delPath).replace(/\\/g, "/");
                    printStatus("-", t.err, `${t.dim}${rel}${t.reset}`);
                } catch (err) {
                    if (err.code !== "ENOENT") printStatus("x", t.err, `${delPath}  ${t.muted}${err.message}${t.reset}`);
                }
            }
        }

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
            sectionHeader("running commands");
            for (const cmd of runs) {
                console.log(`  ${t.muted}$ ${cmd}${t.reset}`);
                const result = await runCommand(cmd, process.cwd());
                if (result.stdout) result.stdout.split("\n").forEach((l) => console.log(`  ${t.dim}  ${l}${t.reset}`));
                if (result.error || result.stderr) {
                    const errOutput = result.stderr || result.error?.message || "";
                    errOutput.split("\n").forEach((l) => console.log(`  ${t.err}  ${l}${t.reset}`));
                    console.log(`\n  ${t.muted}error detected — sending to model for fix${t.reset}`);

                    const fixSpinner = startSpinner("fixing");
                    const fixCtx = systemPrompt + "\n" + buildContext(cmd) + "\n\n";
                    const fixMsg = `The command "${cmd}" produced this error:\n${errOutput}\nFix it by returning a JSON object with the necessary filesToEdit or filesToCreate.`;

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
                            _contextCache = null;
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
                        printStatus("✓", t.ok, "fix applied");
                    } catch (fixErr) {
                        stopSpinner(fixSpinner, "");
                        printStatus("x", t.err, `auto-fix failed  ${t.muted}${fixErr.message || JSON.stringify(fixErr)}${t.reset}`);
                    }
                } else {
                    console.log(`  ${t.ok}  ✓ ok${t.reset}`);
                }
            }
        }

        if (hasFileOps || runs.length > 0) {
            if (message) console.log(`\n  ${t.muted}${message}${t.reset}`);
            const summary = [
                ...actions.map((a) => `created ${path.relative(process.cwd(), a.path).replace(/\\/g, "/")}`),
                ...edits.map((e) => `edited ${path.relative(process.cwd(), e.path).replace(/\\/g, "/")}`),
                ...deletes.map((d) => `deleted ${d}`),
            ].join(", ");
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content: `[${summary}] ${message}` });
        } else if (message) {
            stopSpinner(spinner, "");
            console.log(`\n${marked(message)}\n`);
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content: message });
        } else {
            stopSpinner(spinner, "");
        }

    } catch (err) {
        stopSpinner(spinner, `  ${t.err}✗ error  ${t.muted}${err.message || JSON.stringify(err)}${t.reset}`);
    } finally {
        // This will safely handle restoring the prompt after everything (including early returns)
        askPrompt();
    }
}

// ─── STARTUP BANNER ──────────────────────────────────────────────────────────
function getGitBranch() {
    try { return require("child_process").execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["pipe", "pipe", "pipe"] }).toString().trim(); }
    catch { return null; }
}

function getGitStatus() {
    try {
        const out = require("child_process").execSync("git status --porcelain", { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
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

function getNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getDate() {
    return new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

async function checkForUpdate() {
    try {
        const res = await fetch(`https://registry.npmjs.org/cli-atom/latest`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        const data = await res.json();
        return data.version || null;
    } catch { return null; }
}

async function start() {
    console.clear();
    const w = cols();
    const branch = getGitBranch();
    const status = getGitStatus();
    const cwd = process.cwd();
    const node = process.version;
    const now = getNow();
    const date = getDate();

    const latestVersion = await checkForUpdate();
    const hasUpdate = latestVersion && latestVersion !== VERSION;

    console.log(rule("─"));

    const titleLeft = `  ${t.violet}${t.bold}ATOM${t.reset}  ${t.muted}coding agent${t.reset}`;
    const titleRight = `${t.violetDim}v${VERSION}${t.reset}`;
    const titleRightVis = `v${VERSION}`;
    const titleGap = w - "  ATOM  coding agent".length - titleRightVis.length;
    console.log(titleLeft + " ".repeat(Math.max(0, titleGap)) + titleRight);

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
        const l = `  ${t.violetDim}${label.padEnd(8)}${t.reset}`;
        const v = `${t.muted}${value}${t.reset}`;
        console.log(l + v);
    }

    console.log(rule("─"));

    if (hasUpdate) {
        console.log(`  ${t.warn}⚠ update available${t.reset}  ${t.muted}v${VERSION} → ${t.accent}v${latestVersion}${t.reset}`);
        console.log(`  ${t.dim}run ${t.accent}npm install -g cli-atom${t.dim} to update${t.reset}\n`);
    }

    console.log(`  ${t.ok}✓ ready${t.reset}`);
    askPrompt();
}

start();