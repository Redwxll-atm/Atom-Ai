import path from "path";
import { t } from "./theme.js";
import { sleep } from "./utils.js";
import { state } from "./state.js";

export function cols() {
    return process.stdout.columns || 80;
}

export function rule(char = t.box.horizontal, color = t.primaryDim) {
    return `${color}${char.repeat(cols())}${t.reset}`;
}

export function pad(str, width) {
    const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
    return str + " ".repeat(Math.max(0, width - visible.length));
}

export function elapsed() {
    const s = Math.floor((Date.now() - state.sessionStart) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function startSpinner(label) {
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

export function stopSpinner(timer, msg) {
    clearInterval(timer);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    if (msg) console.log(msg);
}

export function sectionHeader(label) {
    console.log();
    console.log(`  ${t.primary}${label}${t.reset}`);
    console.log(`  ${t.primaryDim}${t.box.horizontal.repeat(Math.min(cols() - 4, 80))}${t.reset}`);
}

export async function showCreatedFile(filePath, content) {
    const lines = content.split("\n");
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    console.log(`  ${t.ok}+${t.reset}  ${t.text}${relPath}${t.reset}  ${t.muted}${lines.length} lines${t.reset}`);
    await sleep(60);

    const preview = lines.slice(0, 8);
    for (let i = 0; i < preview.length; i++) {
        const num = String(i + 1).padStart(3, " ");
        console.log(`     ${t.primaryDim}${t.box.vertical}${t.reset} ${t.subtle}${num}${t.reset}  ${t.dim}${preview[i]}${t.reset}`);
        await sleep(12);
    }
    if (lines.length > 8) {
        console.log(`     ${t.primaryDim}${t.box.vertical}${t.reset} ${t.subtle}   ${t.reset}  ${t.muted}... ${lines.length - 8} more lines${t.reset}`);
    }
    console.log(`     ${t.primaryDim}${t.box.bottomLeft}${t.box.horizontal.repeat(15)}${t.reset}\n`);
}

export async function showDiff(filePath, searchBlock, replaceBlock) {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    console.log(`  ${t.warn}~${t.reset}  ${t.text}${relPath}${t.reset}`);
    await sleep(60);

    for (const line of searchBlock.split("\n")) {
        console.log(`     ${t.primaryDim}${t.box.vertical}${t.reset} ${t.err}-  ${t.dim}${line}${t.reset}`);
        await sleep(18);
    }
    for (const line of replaceBlock.split("\n")) {
        console.log(`     ${t.primaryDim}${t.box.vertical}${t.reset} ${t.ok}+  ${t.text}${line}${t.reset}`);
        await sleep(18);
    }
    console.log(`     ${t.primaryDim}${t.box.bottomLeft}${t.box.horizontal.repeat(15)}${t.reset}\n`);
}

export function printStatus(icon, color, msg) {
    console.log(`  ${color}${icon}${t.reset}  ${msg}`);
}

export function promptSelect(message, choices) {
    return new Promise((resolve) => {
        let index = choices.findIndex(c => c.id === state.MODEL);
        if (index === -1) index = 0;
        let renderedLines = 0;

        function render() {
            if (renderedLines > 0) {
                process.stdout.write(`\r\x1b[${renderedLines}A\x1b[J`);
            } else {
                process.stdout.write(`\r\x1b[J`);
            }
            let out = `\n  ${t.primary}❯ ${t.bold}${message}${t.reset}\n`;
            let lines = 2;

            for (let i = 0; i < choices.length; i++) {
                if (i === index) {
                    out += `    ${t.primary}● ${t.bold}${choices[i].label}${t.reset}\n`;
                } else {
                    out += `    ${t.primaryDim}○ ${t.text}${choices[i].label}${t.reset}\n`;
                }
                lines++;
            }
            process.stdout.write(out);
            renderedLines = lines;
        }

        process.stdout.write("\x1b[?25l"); // hide cursor
        render();

        if (process.stdin.setRawMode) process.stdin.setRawMode(true);
        process.stdin.resume();

        const onData = (key) => {
            if (key === "\u0003") {
                process.stdout.write("\x1b[?25h");
                process.exit();
            }
            if (key === "\x1b[A") { // Up
                index = (index - 1 + choices.length) % choices.length;
                render();
            } else if (key === "\x1b[B") { // Down
                index = (index + 1) % choices.length;
                render();
            } else if (key === "\r" || key === "\n") { // Enter
                if (process.stdin.setRawMode) process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdin.removeListener("data", onData);
                process.stdout.write("\x1b[?25h"); // show cursor
                
                if (renderedLines > 0) {
                    process.stdout.write(`\r\x1b[${renderedLines}A\x1b[J`);
                }
                resolve(choices[index]);
            }
        };

        process.stdin.on("data", onData);
    });
}
