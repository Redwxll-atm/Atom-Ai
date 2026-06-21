export const t = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    italic: "\x1b[3m",
    white: "\x1b[97m",
    gray: "\x1b[90m",
    black: "\x1b[30m",
    
    // Core text
    text: "\x1b[97m", // Bright white
    muted: "\x1b[38;5;248m",
    subtle: "\x1b[38;5;240m",
    
    // Brand / Accents (Luminous/Neon)
    primary: "\x1b[38;5;51m",     // Luminous Neon Cyan
    primaryDim: "\x1b[38;5;39m",  // Deep vibrant blue
    accent: "\x1b[38;5;207m",     // Luminous pink/magenta
    
    // Semantic
    ok: "\x1b[38;5;114m",         // Soft green
    warn: "\x1b[38;5;179m",       // Amber
    err: "\x1b[38;5;167m",        // Soft red
    info: "\x1b[38;5;110m",       // Muted cyan
    
    // Backgrounds
    bgDark: "\x1b[48;5;234m",
    bgMid: "\x1b[48;5;236m",
    bgLight: "\x1b[48;5;238m",
    
    // Unicode box characters for professional UI
    box: {
        topLeft: "╭",
        topRight: "╮",
        bottomLeft: "╰",
        bottomRight: "╯",
        horizontal: "─",
        vertical: "│",
        cross: "┼",
        tDown: "┬",
        tUp: "┴",
        tRight: "├",
        tLeft: "┤"
    }
};
