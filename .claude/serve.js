// Liten statisk server för förhandsvisning. Pythons http.server får inte läsa mappen under Dokument på macOS.
const http=require('http'),fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..'),port=+process.env.PORT||+process.argv[2]||8766;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
http.createServer((req,res)=>{const f=path.join(root,decodeURIComponent(req.url.split('?')[0]).replace(/\/$/,'/index.html'));
  if(!f.startsWith(root))return res.writeHead(403).end();
  fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end('Not found');res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(b);});
}).listen(port,()=>console.log('http://localhost:'+port));
