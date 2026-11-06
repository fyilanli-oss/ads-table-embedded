import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),require=createRequire(import.meta.url);
const routesRequire=createRequire(require.resolve("@react-router/fs-routes"));
const adapterRequire=createRequire(require.resolve("@vercel/react-router/package.json"));
async function routesAt(directory,options){const previous=globalThis.__reactRouterAppDirectory;globalThis.__reactRouterAppDirectory=directory;try{return await require("@react-router/fs-routes").flatRoutes(options);}finally{if(previous===undefined)delete globalThis.__reactRouterAppDirectory;else globalThis.__reactRouterAppDirectory=previous;}}
const flatten=routes=>routes.flatMap(r=>[r.file,...flatten(r.children??[])]).sort();
test("patched real fs-routes preserves the complete existing route tree",async()=>{
 assert.equal(routesRequire("minimatch/package.json").version,"11.0.1");
 assert.equal(routesRequire("minimatch").makeRe,undefined);
 const expected=JSON.parse(readFileSync(new URL("fixtures/pre23-route-config-baseline.json",import.meta.url),"utf8"));
 // The captured baseline is JSON: omit undefined optional properties on both sides.
 assert.deepEqual(JSON.parse(JSON.stringify(await routesAt(path.join(root,"app")))),expected);
});
test("real route discovery retains default hidden-file and explicit file/folder ignores",async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),"adstable-routes-compat-"));
 try{
  for(const file of ["root.tsx","routes/_index.tsx","routes/keep.tsx","routes/omit.tsx","routes/.secret.tsx","routes/skip.folder/route.tsx","routes/keep.folder/route.tsx"]){mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});writeFileSync(path.join(directory,file),"export default function Route(){return null;}\n");}
  const observed=await routesAt(directory,{ignoredRouteFiles:["**/omit*","**/skip*"]});
  assert.deepEqual(flatten(observed),["routes/_index.tsx","routes/keep.folder/route.tsx","routes/keep.tsx"]);
 }finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith("adstable-routes-compat-"));rmSync(directory,{recursive:true,force:true});}
});
test("real ts-morph keeps file glob selection on the exact patched matcher",()=>{
 const tsPath=adapterRequire.resolve("ts-morph"),tsRequire=createRequire(tsPath);
 const commonRequire=createRequire(tsRequire.resolve("@ts-morph/common"));
 assert.equal(commonRequire("minimatch/package.json").version,"11.0.1");
 const {Project}=adapterRequire("ts-morph");const project=new Project({useInMemoryFileSystem:true,skipAddingFilesFromTsConfig:true});
 for(const file of ["/src/a.ts","/src/nested/b.ts","/src/a.test.ts","/other/c.ts"])project.createSourceFile(file,"export const value=1;");
 assert.deepEqual(project.getSourceFiles(["/src/**/*.ts","!/src/**/*.test.ts"]).map(f=>f.getFilePath()).sort(),["/src/a.ts","/src/nested/b.ts"]);
});
