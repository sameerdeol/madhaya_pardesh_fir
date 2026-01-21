import fs from 'fs';
import path from 'path';

export function getDownloadedFiles(req, res) {
    const downloadDir = path.join(process.cwd(), 'download');

    if (!fs.existsSync(downloadDir)) {
        return res.json([]);
    }

    const tree = getFileTree(downloadDir);
    res.json(tree);
}

function getFileTree(dir) {
    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) {
        return {
            name: path.basename(dir),
            type: 'file',
            size: stats.size
        };
    }

    const children = fs.readdirSync(dir).map(child => {
        return getFileTree(path.join(dir, child));
    });

    return {
        name: path.basename(dir),
        type: 'directory',
        children: children
    };
}
