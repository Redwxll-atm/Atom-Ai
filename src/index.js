import fs from "fs";
import { setConfig, CONFIG_FILE } from "./config.js";
import { state, VERSION } from "./state.js";
import { t } from "./theme.js";
import { cols, rule } from "./ui.js";
import { getGitBranch, getGitStatus, getNodeVersion, getNow, getDate, checkForUpdate } from "./utils.js";
import { askPrompt, initPuter } from "./agent.js";
import { promptInput } from "./config.js";

export async function start() {
    process.on("unhandledRejection", (err) => { console.error("unhandled rejection:", err); });
    process.on("uncaughtException", (err) => { console.error("uncaught exception:", err); });

    const args = process.argv.slice(2);

    if (args[0] === "login") {
        console.log();
        console.log(`  ${t.primary}${t.bold}ATOM${t.reset}  ${t.muted}login${t.reset}`);
        console.log();
        console.log(`  ${t.muted}Go to ${t.accent}https://puter.com${t.muted} and generate an API token.${t.reset}`);
        console.log();
        const key = await promptInput(`  ${t.primaryDim}Paste your API key: ${t.reset}`);
        if (!key) {
            console.log(`\n  ${t.err}No key provided. Aborting.${t.reset}\n`);
            process.exit(1);
        }
        setConfig({ apiKey: key });
        console.log(`\n  ${t.ok}API key saved to ${t.dim}${CONFIG_FILE}${t.reset}`);
        console.log(`  ${t.muted}You can now run ${t.accent}atom${t.muted} to start coding!${t.reset}\n`);
        process.exit(0);
    }

    if (args[0] === "logout") {
        try { fs.unlinkSync(CONFIG_FILE); } catch { }
        console.log(`\n  ${t.ok}Logged out. API key removed.${t.reset}\n`);
        process.exit(0);
    }

    if (!state.config.apiKey) {
        console.log();
        console.log(`  ${t.err}No API key found.${t.reset}`);
        console.log(`  ${t.muted}Run ${t.accent}atom login${t.muted} or type ${t.accent}/login${t.muted} after starting atom.${t.reset}`);
        console.log();
        process.exit(1);
    }

    initPuter();

    console.clear();

    const w = cols();
    const branch = getGitBranch();
    const status = getGitStatus();
    const cwd = process.cwd();
    const node = getNodeVersion();
    const now = getNow();
    const date = getDate();

    const latestVersion = await checkForUpdate();
    const hasUpdate = latestVersion && latestVersion !== VERSION;

    console.log();
    console.log(rule(t.box.horizontal));
    console.log();

    const titleLeft = `${t.primary}${t.bold}ATOM${t.reset}  ${t.muted}autonomous coding agent${t.reset}`;
    const titleRight = `${t.primaryDim}v${VERSION}${t.reset}`;
    const titleRightVis = `v${VERSION}`;
    const titleGap = w - "ATOM  autonomous coding agent".length - titleRightVis.length;
    console.log(titleLeft + " ".repeat(Math.max(0, titleGap)) + titleRight);

    console.log();

    const rows = [
        [`model`, state.MODEL_LABEL],
        [`node`, node],
        [`cwd`, cwd.length > 48 ? "..." + cwd.slice(-45) : cwd],
        branch ? [`branch`, branch] : null,
        branch && status ? [`status`, status] : null,
        [`date`, date],
        [`time`, now],
    ].filter(Boolean);

    for (const [label, value] of rows) {
        const l = `  ${t.primaryDim}${label.padEnd(10)}${t.reset}`;
        const v = `${t.text}${value}${t.reset}`;
        console.log(l + v);
    }

    console.log();
    console.log(rule(t.box.horizontal));
    console.log();

    if (hasUpdate) {
        console.log(`  ${t.warn}update available${t.reset}  ${t.muted}v${VERSION} → ${t.accent}v${latestVersion}${t.reset}`);
        console.log(`  ${t.dim}run ${t.accent}npm install -g cli-atom${t.dim} to update${t.reset}`);
        console.log();
    }

    console.log(`${t.primaryDim}ready${t.reset}`);

    askPrompt();
}
