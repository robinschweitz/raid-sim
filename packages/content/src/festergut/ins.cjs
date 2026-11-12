// usage: node ins.cjs file  (reads snippet from stdin) -> inserts before final "});"
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const snip=fs.readFileSync(0,'utf8').replace(/\r?\n/g,'\r\n');
const i=s.lastIndexOf('});');s=s.slice(0,i)+snip+s.slice(i);fs.writeFileSync(f,s);
