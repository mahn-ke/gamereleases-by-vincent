import Bree from 'bree';
const bree = new Bree({
    jobs: [
        {
            name: 'refreshCalendar',
            timeout: 0,
            interval: '5m'
        }
    ]
});

bree.start();

// host simple http server that serves releases.ics
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url !== '/releases.ics') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const filePath = path.join(process.cwd(), 'releases.ics');
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=60'
        });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', () => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server error');
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});