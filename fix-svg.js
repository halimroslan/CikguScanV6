const fs = require('fs');
let code = fs.readFileSync('src/main.ts', 'utf8');

const regex = /<svg viewBox="0 0 100 100".*?>\s+<circle cx="50" cy="50" r="45" stroke="\${strokeColor}" stroke-width="3" fill="\${fillCircle}" \/>\s+<text x="50" y="50" dy="\.35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="400" fill="\${fillText}">\${p}<\/text>\s+<\/svg>/g;

const replaceWith = `<div style="height: 85%; aspect-ratio: 1/1; border: 2.5px solid \${strokeColor}; background-color: \${fillCircle}; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-sizing: border-box;">
                <span style="color: \${fillText}; font-size: 11px; font-weight: 500; font-family: 'Inter', sans-serif;">\${p}</span>
            </div>`;

let count = 0;
code = code.replace(regex, () => {
    count++;
    return replaceWith;
});

// Since some have height: 100%, we should capture it.
const regex2 = /<svg viewBox="0 0 100 100" style="height: (.*?);">\s+<circle cx="50" cy="50" r="45" stroke="\${strokeColor}" stroke-width="3" fill="\${fillCircle}" \/>\s+<text x="50" y="50" dy="\.35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="400" fill="\${fillText}">\${p}<\/text>\s+<\/svg>/g;

code = code.replace(regex2, (match, h) => {
    count++;
    return `<div style="height: ${h}; aspect-ratio: 1/1; border: 2.5px solid \${strokeColor}; background-color: \${fillCircle}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-sizing: border-box; overflow: hidden;">
                <span style="color: \${fillText}; font-size: 11px; font-weight: 500; font-family: 'Inter', sans-serif;">\${p}</span>
            </div>`;
});

fs.writeFileSync('src/main.ts', code, 'utf8');
console.log("Replaced count:", count);
