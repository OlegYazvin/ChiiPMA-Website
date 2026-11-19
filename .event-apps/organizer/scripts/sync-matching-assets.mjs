import {readFileSync,writeFileSync} from 'node:fs';
for(const name of ['matching','stations','general-solver','alternating-solver','question-bank','qr-slots']){
 const source=readFileSync(new URL(`../lib/${name}.mjs`,import.meta.url),'utf8');
 const browser=source.replace(/from '(\.\/[^']+\.mjs)'/g,"from '$1?v=11'");
 writeFileSync(new URL(`../public/${name}.mjs`,import.meta.url),browser);
}
