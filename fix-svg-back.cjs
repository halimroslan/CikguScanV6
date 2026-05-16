const fs = require('fs');
let code = fs.readFileSync('src/main.ts', 'utf8');

const regex = /<div class="flex-1 flex items-center justify-center h-full">\s*<div style="height: (.*?);.*?>\s*<span style="color: \${fillText}; font-size: 11px; font-weight: 500; font-family: 'Inter', sans-serif;">\${p}<\/span>\s*<\/div>\s*<\/div>/g;

const replacement = `<div class="flex-1 flex items-center justify-center h-full">
            <svg viewBox="0 0 100 100" style="height: $1; max-width: 100%;">
                <circle cx="50" cy="50" r="45" stroke="\${strokeColor}" stroke-width="4.5" fill="\${fillCircle}" />
                <text x="50" y="50" dy=".35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="600" fill="\${fillText}">\${p}</text>
            </svg>
        </div>`;

let count = 0;
let newCode = code.replace(regex, (match, g1) => {
    count++;
    return replacement.replace('$1', g1);
});

fs.writeFileSync('src/main.ts', newCode, 'utf8');
console.log("Reverted count:", count);
