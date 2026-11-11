export function words(text){
 return String(text||'').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
}
export function shingles(text,size=7){
 const w=words(text),out=new Set();
 for(let i=0;i<=w.length-size;i++)out.add(w.slice(i,i+size).join(' '));
 return out;
}
export function textOverlap(a,b){
 const left=shingles(a),right=shingles(b);
 if(!left.size||!right.size)return 0;
 let matched=0;for(const s of left)if(right.has(s))matched++;
 return Math.round(matched/left.size*10000)/100;
}
