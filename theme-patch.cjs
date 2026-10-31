'use strict';
// Offline local theme customization. No network, account or vault operations.
process.noAsar = true;
let fs;
try { fs = require('original-fs'); } catch (_) { fs = require('fs'); }
const path = require('path');
const crypto = require('crypto');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function fail(message) { throw new Error(message); }
function fileHash(file) {
  const fd=fs.openSync(file,'r'), h=crypto.createHash('sha256'), chunk=Buffer.alloc(4*1024*1024);
  try { let n; while ((n=fs.readSync(fd,chunk,0,chunk.length,null))>0) h.update(chunk.subarray(0,n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
const original = {
  Light: {palette:['100f0f','d14d41','879a39','d0a215','4385be','ce5d97','3aa99f','fffcf0','6f6e69','af3029','66800b','ad8301','205ea6','a02f6f','24837b','f2f0e5'],background:'fffcf0',cursor:'100f0f',foreground:'100f0f',selection:'100f0f80',ui:'878580'},
  Dark: {palette:['100f0f','af3029','66800b','ad8301','205ea6','a02f6f','24837b','878580','6f6e69','d14d41','879a39','d0a215','4385be','ce5d97','3aa99f','cecdc3'],background:'100f0f',cursor:'cecdc3',foreground:'cecdc3',selection:'cecdc380',ui:'888781'}
};
const themes = {
  Light: {palette:['141413','ad3837','526c3d','886518','386c99','785d98','286e6b','706f68','878580','b85b3d','5e783f','916b12','497dab','8a67a2','35817b','141413'],background:'faf9f5',cursor:'d97757',foreground:'141413',selection:'d9775738',ui:'878580'},
  Dark: {palette:['141413','e1847c','a1b780','ddba77','8eb5dc','b6a2cb','8ec0b5','e8e6dc','8b8980','f2aa8e','bdd399','f0d297','b6d0eb','d0b8e0','add9cb','faf9f5'],background:'262624',cursor:'d97757',foreground:'faf9f5',selection:'d9775759',ui:'a4a198'}
};
function themeSource(name,t) {
  return '{name:'+JSON.stringify(name)+',colorPaletteOverrides:'+JSON.stringify(t.palette.map(c=>'#'+c))+
    ',backgroundColor:"#'+t.background+'",cursorColor:"#'+t.cursor+'",foregroundColor:"#'+t.foreground+
    '",selectionColor:"#'+t.selection+'",app:{terminalUIColor:"#'+t.ui+'"}}';
}
function readAsar(buffer) {
  if (buffer.length<16 || buffer.readUInt32LE(0)!==4) fail('Unsupported ASAR format. No files changed.');
  const base=8+buffer.readUInt32LE(4), jsonLength=buffer.readUInt32LE(12);
  if (jsonLength<2 || jsonLength>64*1024*1024 || 16+jsonLength>base || base>buffer.length) fail('Invalid ASAR header.');
  const raw=buffer.subarray(16,16+jsonLength), header=JSON.parse(raw.toString('utf8')), entries=[];
  function walk(node,prefix) {
    for (const [name,child] of Object.entries(node.files||{})) {
      if (child.files) walk(child,prefix+name+'/');
      else entries.push({name:prefix+name,node:child});
    }
  }
  walk(header,'');
  for (const e of entries) {
    if (e.node.offset===undefined) continue;
    const offset=Number(e.node.offset);
    if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(e.node.size) || e.node.size<0 || base+offset+e.node.size>buffer.length) fail('ASAR file bounds are invalid: '+e.name);
  }
  return {base,jsonLength,raw,header,entries};
}
function patchAsar(input) {
  const archive=readAsar(input), output=Buffer.from(input), changes=[];
  if (JSON.stringify(archive.header)!==archive.raw.toString('utf8')) fail('Unsupported ASAR header serialization.');
  for (const item of archive.entries) {
    const e=item.node;
    if (e.offset===undefined || !item.name.endsWith('.js')) continue;
    const start=archive.base+Number(e.offset), oldBytes=input.subarray(start,start+e.size);
    let source=oldBytes.toString('utf8');
    if (!source.includes('name:"Flexoki Light"') && !source.includes('name:"Flexoki Dark"')) continue;
    for (const variant of ['Light','Dark']) {
      const oldText=themeSource('Flexoki '+variant,original[variant]);
      if (source.split(oldText).length!==2) fail('Unrecognized or modified theme definition: '+item.name);
      const replacement=themeSource('Claude '+variant,themes[variant]);
      if (replacement.length>oldText.length) fail('Theme replacement exceeds its allocated size.');
      source=source.replace(oldText,replacement+' '.repeat(oldText.length-replacement.length));
    }
    // Keep the theme popularity metadata consistent with the renamed presets.
    source=source.replace(/"flexoki (light|dark)"/g,(_,v)=>'"claude '+v+'" ');
    const bytes=Buffer.from(source,'utf8');
    if (bytes.length!==e.size) fail('Unexpected bundle size change.');
    const integrity=e.integrity;
    if (!integrity || integrity.algorithm!=='SHA256' || sha(oldBytes)!==integrity.hash) fail('ASAR source integrity mismatch: '+item.name);
    if (!Number.isSafeInteger(integrity.blockSize) || integrity.blockSize<=0) fail('Invalid ASAR hash block size.');
    const blocks=[];
    for (let at=0; at<bytes.length; at+=integrity.blockSize) {
      if (sha(oldBytes.subarray(at,at+integrity.blockSize))!==integrity.blocks[blocks.length]) fail('ASAR source block mismatch: '+item.name);
      blocks.push(sha(bytes.subarray(at,at+integrity.blockSize)));
    }
    if (blocks.length!==integrity.blocks.length) fail('Invalid ASAR block count.');
    e.integrity={...integrity,hash:sha(bytes),blocks};
    bytes.copy(output,start); changes.push(item.name);
  }
  if (changes.length!==4) fail('Unsupported Termius build: expected four matching theme modules, found '+changes.length+'. No files changed.');
  const nextHeader=Buffer.from(JSON.stringify(archive.header),'utf8');
  if (nextHeader.length!==archive.jsonLength) fail('ASAR header length changed.');
  nextHeader.copy(output,16);
  return {buffer:output,changes,oldHeaderHash:sha(archive.raw),newHeaderHash:sha(nextHeader)};
}
function peLayout(buffer) {
  if (buffer.length<256 || buffer.toString('ascii',0,2)!=='MZ') fail('Invalid Windows executable.');
  const at=buffer.readUInt32LE(0x3c);
  if (at+24>buffer.length || buffer.readUInt32LE(at)!==0x4550) fail('Invalid PE header.');
  const optional=at+24, optionalSize=buffer.readUInt16LE(at+20), sections=[];
  const magic=buffer.readUInt16LE(optional);
  if (magic!==0x20b && magic!==0x10b) fail('Unsupported executable architecture.');
  const directories=optional+(magic===0x20b?112:96);
  for (let i=0; i<buffer.readUInt16LE(at+6); i++) {
    const p=optional+optionalSize+i*40;
    if (p+40>buffer.length) fail('Invalid PE section table.');
    sections.push({rva:buffer.readUInt32LE(p+12),size:buffer.readUInt32LE(p+16),offset:buffer.readUInt32LE(p+20)});
  }
  function raw(rva) {
    const section=sections.find(s=>rva>=s.rva && rva<s.rva+s.size);
    if (!section) fail('PE resource address is invalid.');
    return section.offset+rva-section.rva;
  }
  return {raw,resourceBase:raw(buffer.readUInt32LE(directories+16)),checksumOffset:optional+64};
}
function readIntegrityResource(buffer) {
  const layout=peLayout(buffer), base=layout.resourceBase, found=[];
  function visit(relative,names,depth) {
    if (depth>3) fail('Invalid resource directory depth.');
    const at=base+relative;
    if (at<0 || at+16>buffer.length) fail('Invalid resource directory.');
    const count=buffer.readUInt16LE(at+12)+buffer.readUInt16LE(at+14);
    if (count>4096 || at+16+count*8>buffer.length) fail('Invalid resource directory count.');
    for (let i=0; i<count; i++) {
      const name=buffer.readUInt32LE(at+16+i*8), target=buffer.readUInt32LE(at+20+i*8);
      let label=String(name);
      if (name&0x80000000) {
        const p=base+(name&0x7fffffff), size=buffer.readUInt16LE(p)*2;
        if (p+2+size>buffer.length) fail('Invalid PE resource name.');
        label=buffer.toString('utf16le',p+2,p+2+size);
      }
      const chain=names.concat(label);
      if (target&0x80000000) visit(target&0x7fffffff,chain,depth+1);
      else if (chain[0].toUpperCase()==='INTEGRITY' && chain[1].toUpperCase()==='ELECTRONASAR') {
        const p=base+target, offset=layout.raw(buffer.readUInt32LE(p)), size=buffer.readUInt32LE(p+4);
        if (offset+size>buffer.length) fail('Invalid embedded integrity record.');
        const raw=buffer.toString('utf8',offset,offset+size), records=JSON.parse(raw);
        found.push({offset,size,raw,records});
      }
    }
  }
  visit(0,[],0);
  if (found.length!==1) fail('Expected exactly one Electron integrity resource.');
  return found[0];
}
function readFuses(buffer) {
  const sentinel=Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), at=buffer.indexOf(sentinel);
  if (at<0 || buffer.indexOf(sentinel,at+1)>=0) fail('Unsupported Electron fuse layout.');
  const start=at+sentinel.length, version=buffer[start], count=buffer[start+1];
  if (version!==1 || count<6 || count>64) fail('Unsupported Electron fuse version.');
  return Buffer.from(buffer.subarray(start,start+2+count));
}
function peChecksum(buffer,offset) {
  let sum=0;
  for (let i=0; i<buffer.length; i+=2) {
    if (i===offset || i===offset+2) continue;
    sum+=(buffer[i] || 0)+((buffer[i+1] || 0)*256);
    sum=(sum&0xffff)+(sum>>>16);
  }
  sum=(sum&0xffff)+(sum>>>16);
  return (sum+buffer.length)>>>0;
}
function patchExecutable(input,oldHash,newHash) {
  const fuses=readFuses(input);
  if (fuses[2+4]!==0x31) fail('This build has a different integrity configuration. No files changed.');
  const resource=readIntegrityResource(input);
  if (resource.records.length!==1 || resource.records[0].alg.toUpperCase()!=='SHA256' || resource.records[0].value!==oldHash) fail('EXE/ASAR integrity records do not match. No files changed.');
  const token='"value":"'+oldHash+'"';
  if (resource.raw.split(token).length!==2 || !/^[a-f0-9]{64}$/.test(newHash)) fail('Invalid embedded integrity hash.');
  const next=Buffer.from(input), replacement=resource.raw.replace(token,'"value":"'+newHash+'"');
  if (Buffer.byteLength(replacement)!==resource.size) fail('Executable resource size changed.');
  next.write(replacement,resource.offset,resource.size,'utf8');
  const checksum=peLayout(input).checksumOffset;
  next.writeUInt32LE(peChecksum(next,checksum),checksum);
  return next;
}
function locations(app) {
  return {app,exe:path.join(app,'Termius.exe'),asar:path.join(app,'resources','app.asar'),root:path.join(app,'claude-theme-backup')};
}
function atomicJSON(file,data) {
  const temp=file+'.tmp-'+crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{flag:'wx'}); fs.renameSync(temp,file);
}
function stateFor(loc) {
  const file=path.join(loc.root,'active.json');
  if (!fs.existsSync(file)) return null;
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  if (state.format!==1 || !/^[a-f0-9]{64}$/.test(state.id)) fail('Invalid theme backup manifest.');
  return state;
}
function verifyBackup(loc,state) {
  const folder=path.join(loc.root,state.id);
  for (const name of ['exe','asar']) {
    const backup=path.join(folder,name+'.original');
    if (fileHash(backup)!==state.original[name]) fail('Theme backup checksum mismatch.');
  }
  return folder;
}
function replaceBytes(file,bytes) {
  const temp=file+'.claude-stage-'+crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(temp,bytes,{flag:'wx'});
    if (fileHash(temp)!==sha(bytes)) fail('Staged file checksum mismatch.');
    fs.renameSync(temp,file);
  } finally {if (fs.existsSync(temp)) fs.unlinkSync(temp);}
}
function install(app) {
  const loc=locations(app), current={exe:fileHash(loc.exe),asar:fileHash(loc.asar)}, active=stateFor(loc);
  if (active && current.exe===active.patched.exe && current.asar===active.patched.asar) {
    verifyBackup(loc,active); return {status:'already-installed'};
  }
  const output=patchAsar(fs.readFileSync(loc.asar));
  const exe=patchExecutable(fs.readFileSync(loc.exe),output.oldHeaderHash,output.newHeaderHash);
  if (fileHash(loc.exe)!==current.exe || fileHash(loc.asar)!==current.asar) fail('Termius files changed during validation. Close Termius and retry.');
  const state={format:1,id:current.asar,status:'pending',original:current,patched:{exe:sha(exe),asar:sha(output.buffer)},modules:output.changes};
  const folder=path.join(loc.root,state.id); fs.mkdirSync(folder,{recursive:true});
  for (const name of ['exe','asar']) {
    const backup=path.join(folder,name+'.original');
    if (!fs.existsSync(backup)) fs.copyFileSync(loc[name],backup,fs.constants.COPYFILE_EXCL);
  }
  verifyBackup(loc,state); atomicJSON(path.join(loc.root,'active.json'),state);
  try {
    replaceBytes(loc.asar,output.buffer); replaceBytes(loc.exe,exe);
    state.status='installed'; atomicJSON(path.join(loc.root,'active.json'),state);
  } catch (error) {
    try {restore(app);} catch (recovery) {error.message+=' Recovery: '+recovery.message;}
    throw error;
  }
  return {status:'installed',modules:output.changes};
}
function restore(app) {
  const loc=locations(app), state=stateFor(loc);
  if (!state) fail('No theme backup exists for this installation.');
  const folder=verifyBackup(loc,state);
  for (const name of ['exe','asar']) {
    const hash=fileHash(loc[name]);
    if (hash!==state.original[name] && hash!==state.patched[name]) fail('Termius files changed after installation, possibly by an update. Refusing to overwrite them.');
  }
  for (const name of ['asar','exe']) if (fileHash(loc[name])!==state.original[name]) replaceBytes(loc[name],fs.readFileSync(path.join(folder,name+'.original')));
  state.status='restored'; atomicJSON(path.join(loc.root,'active.json'),state);
  return {status:'restored'};
}
module.exports={themes,readAsar,patchAsar,peLayout,readIntegrityResource,readFuses,patchExecutable,fileHash,install,restore};
if (require.main===module) {
  try {
    const args=process.argv.slice(2), mode=args[0], app=args[1];
    if (!app || !['install','restore','check'].includes(mode)) fail('Usage: theme-patch.cjs install|restore|check APP_DIRECTORY');
    let result;
    if (mode==='check') {
      const loc=locations(app), data=patchAsar(fs.readFileSync(loc.asar));
      patchExecutable(fs.readFileSync(loc.exe),data.oldHeaderHash,data.newHeaderHash);
      result={status:'compatible',modules:data.changes};
    } else result=mode==='install'?install(app):restore(app);
    console.log(JSON.stringify(result,null,2));
  } catch (error) {console.error('ERROR: '+error.message);process.exitCode=1;}
}
