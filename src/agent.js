import fs from "fs";
import path from "path";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { init } from "@heyputer/puter.js/src/init.cjs";

import { t } from "./theme.js";
import { state, MODELS, systemPrompt } from "./state.js";
import { setConfig, CONFIG_FILE, promptInput } from "./config.js";
import { 
    cols, rule, pad, elapsed, startSpinner, stopSpinner, 
    sectionHeader, showCreatedFile, showDiff, printStatus, promptSelect
} from "./ui.js";
import { buildContext, invalidateContext } from "./context.js";
import { runCommand } from "./utils.js";

marked.use(markedTerminal());

let puter = null;

export function initPuter() {
    if (state.config.apiKey) {
        puter = init(state.config.apiKey);
    }
}

const SLASH_COMMANDS = [
    { name: "help", desc: "Show all available commands" },
    { name: "model", desc: "List or switch AI model" },
    { name: "key", desc: "View your current API key" },
    { name: "login", desc: "Set a new API key" },
    { name: "logout", desc: "Remove your API key" },
    { name: "quit", desc: "Exit the CLI" },
];

export function askPrompt() {
    console.log();
    console.log(rule());

    const sessionStats = `${state.filesCreated} created   ${state.filesEdited} edited`;
    const left = `${t.subtle}${sessionStats}${t.reset}`;
    const right = `${t.muted}${state.MODEL_LABEL}   ${state.promptCount} req   ${elapsed()}${t.reset}`;
    const rightVisible = right.replace(/\x1b\[[0-9;]*m/g, "");
    const gap = cols()
        - left.replace(/\x1b\[[0-9;]*m/g, "").length
        - rightVisible.length;
    console.log(left + " ".repeat(Math.max(0, gap)) + right);
    console.log();

    let input = "";
    let menuActive = false;
    let menuIndex = 0;
    let menuItems = [];
    let menuLineCount = 0;

    const BG = "\x1b[48;5;238m";
    const FG = "\x1b[38;5;255m";
    const FGP = "\x1b[38;5;245m";
    const PAD = " ";

    function getFilteredCommands() {
        const query = input.slice(1).toLowerCase();
        return SLASH_COMMANDS.filter(c => c.name.startsWith(query));
    }

    let renderedLines = 0;

    function renderAll() {
        if (renderedLines > 0) {
            process.stdout.write(`\r\x1b[${renderedLines}A\x1b[J`);
        } else {
            process.stdout.write(`\r\x1b[J`);
        }
        
        let out = "";
        let menuLines = 0;

        if (menuActive) {
            menuItems = getFilteredCommands();
            if (menuIndex >= menuItems.length) menuIndex = 0;
            if (menuItems.length > 0) {
                const nameWidth = Math.max(...menuItems.map(c => c.name.length)) + 2;
                for (let i = 0; i < menuItems.length; i++) {
                    const item = menuItems[i];
                    const isSelected = i === menuIndex;
                    const namePad = ("/" + item.name).padEnd(nameWidth);
                    if (isSelected) {
                        out += `  ${t.primary}❯ ${t.bold}${namePad}${t.reset}  ${t.text}${item.desc}${t.reset}\n`;
                    } else {
                        out += `    ${t.primaryDim}${namePad}${t.reset}  ${t.muted}${item.desc}${t.reset}\n`;
                    }
                    menuLines++;
                }
                out += `  ${t.subtle}(${menuIndex + 1}/${menuItems.length})${t.reset}\n`;
                menuLines++;
            }
        }

        const promptPrefix = `  ${t.primary}❯ ${t.reset}`;
        if (input.length === 0) {
            const placeholder = "insert your instruction...";
            out += promptPrefix + `${t.muted}${placeholder}${t.reset}`;
            out += `\x1b[${placeholder.length}D`;
        } else {
            out += promptPrefix + `${t.text}${input}${t.reset}`;
        }

        process.stdout.write(out);
        renderedLines = menuLines;
    }

    function onResize() { renderAll(); }
    process.stdout.on("resize", onResize);

    process.stdout.write("\x1b[?25h"); // ensure cursor is visible
    renderAll();

    if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function cleanup() {
        if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.removeListener("resize", onResize);
        process.stdout.write("\x1b[?25h");
    }

    function submitInput(value) {
        if (renderedLines > 0) {
            process.stdout.write(`\r\x1b[${renderedLines}A\x1b[J`);
        } else {
            process.stdout.write(`\r\x1b[J`);
        }
        console.log(`  ${t.primary}❯ ${t.text}${value}${t.reset}`);
        handleInput(value);
    }

    function onData(key) {
        if (key === "\u0003") { process.stdout.write("\x1b[?25h"); process.exit(); }

        if (key === "\x1b[A") {
            if (menuActive && menuItems.length > 0) {
                menuIndex = (menuIndex - 1 + menuItems.length) % menuItems.length;
                renderAll();
            }
            return;
        }

        if (key === "\x1b[B") {
            if (menuActive && menuItems.length > 0) {
                menuIndex = (menuIndex + 1) % menuItems.length;
                renderAll();
            }
            return;
        }

        if (key === "\t") {
            if (menuActive && menuItems.length > 0) {
                input = "/" + menuItems[menuIndex].name;
                renderAll();
            }
            return;
        }

        if (key === "\r" || key === "\n") {
            if (menuActive && menuItems.length > 0) {
                const selected = "/" + menuItems[menuIndex].name;
                cleanup();
                if (renderedLines > 0) {
                    process.stdout.write(`\r\x1b[${renderedLines}A\x1b[J`);
                } else {
                    process.stdout.write(`\r\x1b[J`);
                }
                console.log(`  ${t.primary}❯ ${t.text}${selected}${t.reset}`);
                handleInput(selected);
                return;
            }
            if (!input.trim()) return;
            cleanup();
            submitInput(input);
            return;
        }

        if (key === "\x1b") {
            if (menuActive) {
                menuActive = false;
                renderAll();
            }
            return;
        }

        if (key === "\x7f" || key === "\b") {
            input = input.slice(0, -1);
            if (input === "") {
                menuActive = false;
            } else if (input.startsWith("/")) {
                menuActive = true;
                menuIndex = 0;
            }
            renderAll();
            return;
        }

        if (key.charCodeAt(0) >= 32) {
            input += key;
            if (input.startsWith("/")) {
                menuActive = true;
                menuIndex = 0;
            } else {
                menuActive = false;
            }
            renderAll();
        }
    }

    process.stdin.on("data", onData);
}

export async function handleInput(raw) {
    const userPrompt = raw.trim();

    if (!userPrompt) { askPrompt(); return; }

    if (userPrompt.toLowerCase() === "exit" || userPrompt.toLowerCase() === "quit") {
        console.log();
        console.log(`  ${t.muted}session ended   ${state.filesCreated} created   ${state.filesEdited} edited   ${elapsed()}${t.reset}`);
        console.log();
        process.exit(0);
        return;
    }

    if (userPrompt.toLowerCase() === "/help") {
        console.log();
        console.log(`  ${t.primary}${t.bold}Available commands${t.reset}`);
        console.log(`  ${t.primaryDim}${"─".repeat(30)}${t.reset}`);
        console.log(`  ${t.primaryDim}/help${t.reset}          ${t.muted}show this help message${t.reset}`);
        console.log(`  ${t.primaryDim}/model${t.reset}         ${t.muted}list available AI models${t.reset}`);
        console.log(`  ${t.primaryDim}/model <name>${t.reset}  ${t.muted}switch to a specific model${t.reset}`);
        console.log(`  ${t.primaryDim}/key${t.reset}           ${t.muted}view your current API key${t.reset}`);
        console.log(`  ${t.primaryDim}/login${t.reset}         ${t.muted}set a new API key${t.reset}`);
        console.log(`  ${t.primaryDim}/logout${t.reset}        ${t.muted}remove your API key${t.reset}`);
        console.log(`  ${t.primaryDim}exit / quit${t.reset}    ${t.muted}end the session${t.reset}`);
        console.log();
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase().startsWith("/model")) {
        const parts = userPrompt.split(" ");
        if (parts.length === 1) {
            process.stdin.setRawMode(false);
            process.stdin.resume();
            
            const selected = await promptSelect("Select a model:", MODELS);
            
            state.MODEL = selected.id;
            state.MODEL_LABEL = selected.label;
            console.log(`\n  ${t.ok}Model switched to ${t.bold}${state.MODEL_LABEL}${t.reset}\n`);
            
            askPrompt();
            return;
        }

        const selection = parts[1].toLowerCase();
        const selected = MODELS.find(m => m.label.toLowerCase() === selection) ||
            MODELS.find(m => m.id.toLowerCase() === selection) ||
            MODELS[parseInt(selection) - 1];

        if (selected) {
            state.MODEL = selected.id;
            state.MODEL_LABEL = selected.label;
            console.log(`\n  ${t.ok}Model switched to ${t.bold}${state.MODEL_LABEL}${t.reset}\n`);
        } else {
            console.log(`\n  ${t.err}Model not found. Type '/model' to see the list.${t.reset}\n`);
        }
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase() === "/key") {
        const masked = state.config.apiKey ? state.config.apiKey.slice(0, 10) + "..." + state.config.apiKey.slice(-6) : "none";
        console.log(`\n  ${t.primary}API Key${t.reset}`);
        console.log(`  ${t.muted}current: ${masked}${t.reset}`);
        console.log(`  ${t.dim}To change your key, type ${t.accent}/login${t.dim}.${t.reset}\n`);
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase() === "/logout") {
        try { fs.unlinkSync(CONFIG_FILE); } catch { }
        state.config.apiKey = null;
        console.log(`\n  ${t.ok}Logged out. API key removed.${t.reset}`);
        console.log(`  ${t.muted}Type ${t.accent}/login${t.muted} to authenticate again.${t.reset}\n`);
        askPrompt();
        return;
    }

    if (userPrompt.toLowerCase() === "/login") {
        console.log();
        console.log(`  ${t.primary}${t.bold}Login${t.reset}`);
        console.log(`  ${t.muted}Go to ${t.accent}https://puter.com${t.muted} and generate an API token.${t.reset}`);
        console.log();

        process.stdin.setRawMode(false);
        process.stdin.resume();
        const key = await promptInput(`  ${t.primaryDim}Paste your API key: ${t.reset}`);

        if (!key) {
            console.log(`\n  ${t.err}No key provided.${t.reset}\n`);
            askPrompt();
            return;
        }

        setConfig({ apiKey: key });
        state.config.apiKey = key;
        puter = init(key);
        console.log(`\n  ${t.ok}API key saved and applied!${t.reset}`);
        console.log(`  ${t.muted}You can now send prompts.${t.reset}\n`);
        askPrompt();
        return;
    }

    state.promptCount++;

    if (state.conversationHistory.length > 6) state.conversationHistory = state.conversationHistory.slice(-6);

    const projectContext = buildContext();
    let fullPrompt = systemPrompt + "\n" + projectContext + "\n";

    if (state.conversationHistory.length > 0) {
        fullPrompt += "--- Conversation History ---\n";
        state.conversationHistory.forEach((msg) => {
            fullPrompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n\n`;
        });
        fullPrompt += "--- End of History ---\n\n";
    }

    fullPrompt += `User prompt: ${userPrompt}`;

    console.log();
    const spinner = startSpinner("thinking");

    try {
        const response = await puter.ai.chat(fullPrompt, { model: state.MODEL });
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
            state.conversationHistory.push({ role: "user", content: userPrompt });
            state.conversationHistory.push({ role: "assistant", content });
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
                    invalidateContext();
                    await showCreatedFile(action.path, action.content);
                    state.filesCreated++;
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
                        invalidateContext();
                        await showDiff(edit.path, edit.search, edit.replace);
                        state.filesEdited++;
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
                        const fixRes = await puter.ai.chat(fixCtx + fixMsg, { model: state.MODEL });
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
                                    invalidateContext();
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
            state.conversationHistory.push({ role: "user", content: userPrompt });
            state.conversationHistory.push({ role: "assistant", content: `[${summary}] ${message}` });
        } else if (message) {
            stopSpinner(spinner);
            console.log(`\n${marked(message)}\n`);
            state.conversationHistory.push({ role: "user", content: userPrompt });
            state.conversationHistory.push({ role: "assistant", content: message });
        } else {
            stopSpinner(spinner);
        }

    } catch (err) {
        stopSpinner(spinner, `  ${t.err}error  ${t.muted}${err.message || JSON.stringify(err)}${t.reset}`);
    } finally {
        askPrompt();
    }
}
