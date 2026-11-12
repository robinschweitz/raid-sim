const fs=require('fs');
function edit(f,pairs){let s=fs.readFileSync(f,'utf8');const crlf=s.includes('\r\n');s=s.replace(/\r\n/g,'\n');
for(const [o,n] of pairs){const c=s.split(o).length-1;if(c!==1){console.error(f,'match',c,o);process.exit(1);}s=s.replace(o,()=>n);}
if(crlf)s=s.replace(/\n/g,'\r\n');fs.writeFileSync(f,s);}
module.exports=edit;
