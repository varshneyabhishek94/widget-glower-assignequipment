const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 5000;
const APP_DIR = path.join(__dirname, "app");

const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
};

const server = https.createServer(
  {
    key:  fs.readFileSync(path.join(__dirname, "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "cert.pem")),
  },
  (req, res) => {
    let url = req.url.split("?")[0];
    if (url === "/") url = "/index.html";

    const filePath = path.join(APP_DIR, url);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
  }
);

server.listen(PORT, () => {
  console.log(`HTTPS server running at https://127.0.0.1:${PORT}/`);
});
