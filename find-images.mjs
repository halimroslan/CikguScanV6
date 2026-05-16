import fs from 'fs';
import path from 'path';

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git')) {
            results = results.concat(walk(file));
        } else {
            if (/\.(png|jpe?g|svg|ico)$/i.test(file)) {
                results.push(file);
            }
        }
    });
    return results;
}

console.log("Found images:", walk('.'));
