// usage: node rep.cjs file oldfile newfile  (LF-normalised matching, writes CRLF if file had CRLF)
const fs=require('fs');const [f,o,n]=process.argv.slice(2);
let s=fs.readFileSync(f,'utf8');const crlf=s.includes('\r\n');s=s.replace(/\r\n/g,'\n');
const old=fs.readFileSync(o,'utf8').replace(/\n$/,'');const nw=fs.readFileSync(n,'utf8').replace(/\n$/,'');
const c=s.split(old).length-1;if(c!==1){console.error('match count',c);process.exit(1);}
s=s.replace(old,()=>nw);if(crlf)s=s.replace(/\n/g,'\r\n');fs.writeFileSync(f,s);
