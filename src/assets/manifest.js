// Every asset the game can use. Nothing here is synthesized: each slot is filled only by
// real recordings or photographed/scanned textures that you provide. An empty slot is silent
// (audio) or falls back to an untextured graybox colour (materials).
//
// File naming: the slot id with dots or underscores, plus an optional variant number.
//   gun.9mm.fire.indoor_01.wav   gun_9mm_fire_indoor_02.ogg   mat.carpet.albedo.jpg
// Several variants per slot are picked at random with no immediate repeats.

export const AUDIO_SLOTS = [
  // Ambience
  { id:'amb.hvac.loop',          group:'Ambience', loop:true,  desc:'Industrial HVAC hum, seamless loop (air handler, duct rumble)' },
  { id:'amb.roomtone.loop',      group:'Ambience', loop:true,  desc:'Empty office room tone, seamless loop' },
  { id:'light.buzz.loop',        group:'Lights',   loop:true,  spatial:true, ref:2, max:9, desc:'Fluorescent ballast buzz, close-miked loop' },
  { id:'light.pop',              group:'Lights',   spatial:true, ref:2, max:20, desc:'Fluorescent tube flicker pop / starter click (electrical)' },
  // Weapons (indoor recordings with concrete reflections are ideal)
  { id:'gun.9mm.fire',           group:'Weapons',  spatial:true, ref:6, max:80, important:true, desc:'9mm pistol/SMG shot recorded indoors, concrete room' },
  { id:'gun.45acp.fire',         group:'Weapons',  spatial:true, ref:6, max:80, important:true, desc:'.45 ACP shot recorded indoors' },
  { id:'gun.556.fire',           group:'Weapons',  spatial:true, ref:8, max:110, important:true, desc:'5.56 rifle shot recorded indoors' },
  { id:'gun.762.fire',           group:'Weapons',  spatial:true, ref:8, max:110, important:true, desc:'7.62×39 rifle shot recorded indoors' },
  { id:'gun.12ga.fire',          group:'Weapons',  spatial:true, ref:8, max:100, important:true, desc:'12 gauge shot recorded indoors' },
  { id:'gun.suppressed.fire',    group:'Weapons',  spatial:true, ref:3, max:30, desc:'Suppressed shot (any caliber)' },
  { id:'gun.tail.concrete',      group:'Weapons',  spatial:false, desc:'Gunshot reverb tail from a concrete corridor or bunker' },
  { id:'gun.bolt.rack',          group:'Weapons',  spatial:true, ref:2, max:15, desc:'Charging handle / bolt rack, metallic' },
  { id:'gun.pump',               group:'Weapons',  spatial:true, ref:2, max:15, desc:'Shotgun pump action' },
  { id:'gun.mag.out',            group:'Weapons',  spatial:true, ref:2, max:12, desc:'Magazine release and drop' },
  { id:'gun.mag.in',             group:'Weapons',  spatial:true, ref:2, max:12, desc:'Magazine insert and seat' },
  { id:'gun.shell.load',         group:'Weapons',  spatial:true, ref:2, max:12, desc:'Shotgun shell loaded into tube' },
  { id:'gun.dryfire',            group:'Weapons',  spatial:true, ref:1, max:6,  desc:'Trigger click on an empty chamber' },
  { id:'casing.concrete',        group:'Weapons',  spatial:true, ref:1, max:10, desc:'Brass casing bouncing on concrete' },
  { id:'casing.carpet',          group:'Weapons',  spatial:true, ref:1, max:6,  desc:'Brass casing landing on carpet' },
  // Impacts
  { id:'impact.concrete',        group:'Impacts',  spatial:true, ref:2, max:30, desc:'Bullet impact on concrete (chips, spall)' },
  { id:'impact.drywall',         group:'Impacts',  spatial:true, ref:2, max:25, desc:'Bullet through drywall / plasterboard' },
  { id:'impact.metal',           group:'Impacts',  spatial:true, ref:2, max:30, desc:'Bullet on sheet metal or vent grille' },
  { id:'ricochet',               group:'Impacts',  spatial:true, ref:3, max:40, desc:'Ricochet whine off concrete' },
  { id:'impact.flesh',           group:'Impacts',  spatial:true, ref:2, max:20, desc:'Bullet into meat (foley: cabbage, raw meat)' },
  { id:'gore.dismember',         group:'Impacts',  spatial:true, ref:2, max:20, desc:'Wet tear / bone snap (foley)' },
  { id:'gore.splat',             group:'Impacts',  spatial:true, ref:1, max:10, desc:'Wet splatter on a hard floor' },
  // Movement
  { id:'foot.carpet',            group:'Movement', spatial:true, ref:1, max:10, desc:'Boot step on damp carpet' },
  { id:'foot.concrete',          group:'Movement', spatial:true, ref:1, max:14, desc:'Boot step on concrete' },
  { id:'foot.blood',             group:'Movement', spatial:true, ref:1, max:8,  desc:'Boot step in liquid (squelch)' },
  { id:'scrape.concrete',        group:'Movement', spatial:true, ref:2, max:20, desc:'Something dragged over concrete' },
  // Entities
  { id:'hound.step',             group:'Entities', spatial:true, ref:1, max:14, desc:'Bare hands and knees slapping a floor' },
  { id:'hound.scream',           group:'Entities', spatial:true, ref:5, max:70, desc:'Distorted human throat scream' },
  { id:'bacteria.click',         group:'Entities', spatial:true, ref:2, max:25, desc:'Wet clicking / joint cracking' },
  { id:'skin.whisper',           group:'Entities', spatial:true, ref:2, max:18, desc:'Close whisper, human voice' },
  { id:'creature.death',         group:'Entities', spatial:true, ref:4, max:40, desc:'Gurgling death rattle (human voice, processed is fine)' },
  { id:'vent.crawl',             group:'Entities', spatial:true, ref:2, max:25, desc:'Something moving inside sheet-metal ductwork' },
  { id:'vent.burst',             group:'Entities', spatial:true, ref:3, max:35, desc:'Vent cover kicked out, metal clatter' },
  // Operator
  { id:'breath.mask.loop',       group:'Operator', loop:true, desc:'Breathing through a respirator, loop' },
  { id:'breath.heavy',           group:'Operator', desc:'Hard breathing after sprinting' },
  { id:'player.hurt',            group:'Operator', desc:'Pain grunt' },
  { id:'nvg.on',                 group:'Operator', desc:'Image-intensifier whine on power-up' },
  // Terminal
  { id:'crt.hum.loop',           group:'Terminal', loop:true, desc:'CRT monitor flyback whine and hum, loop' },
  { id:'crt.degauss',            group:'Terminal', desc:'CRT degauss thunk' },
  { id:'ui.key',                 group:'Terminal', desc:'Mechanical keyboard key press' },
  { id:'ui.relay',               group:'Terminal', desc:'Relay click' },
  // Impulse responses for the convolution reverb (recorded IRs only)
  { id:'ir.corridor',            group:'Impulse responses', ir:true, desc:'Impulse response recorded in a long concrete corridor' },
  { id:'ir.office',              group:'Impulse responses', ir:true, desc:'Impulse response recorded in a small office' },
];

export const TEXTURE_SLOTS = [
  { id:'mat.carpet.albedo',     mat:0, kind:'albedo',    desc:'Damp office carpet, colour (seamless, ~2 m repeat)' },
  { id:'mat.carpet.normal',     mat:0, kind:'normal',    desc:'Carpet normal map (OpenGL convention)' },
  { id:'mat.carpet.roughness',  mat:0, kind:'roughness', desc:'Carpet roughness' },
  { id:'mat.wallpaper.albedo',  mat:1, kind:'albedo',    desc:'Stained yellow wallpaper, colour (seamless, ~1.6 m repeat)' },
  { id:'mat.wallpaper.normal',  mat:1, kind:'normal',    desc:'Wallpaper normal map' },
  { id:'mat.wallpaper.roughness', mat:1, kind:'roughness', desc:'Wallpaper roughness' },
  { id:'mat.concrete.albedo',   mat:2, kind:'albedo',    desc:'Poured concrete, colour (seamless, ~2.4 m repeat)' },
  { id:'mat.concrete.normal',   mat:2, kind:'normal',    desc:'Concrete normal map' },
  { id:'mat.concrete.roughness', mat:2, kind:'roughness', desc:'Concrete roughness' },
  { id:'mat.metal.albedo',      mat:3, kind:'albedo',    desc:'Painted sheet metal (vents), colour' },
  { id:'mat.metal.normal',      mat:3, kind:'normal',    desc:'Sheet metal normal map' },
  { id:'mat.metal.roughness',   mat:3, kind:'roughness', desc:'Sheet metal roughness' },
];

const ALL = [...AUDIO_SLOTS, ...TEXTURE_SLOTS];
const BY_ID = new Map(ALL.map(s => [s.id, s]));

// "gun_9mm_fire-03.WAV" -> slot "gun.9mm.fire"
export function slotForFilename(name) {
  const base = name.split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  let key = base.replace(/[\s_\-]+/g, '.').replace(/\.+/g, '.');
  key = key.replace(/\.(v|var|take)?\d{1,3}$/i, '');
  if (BY_ID.has(key)) return BY_ID.get(key);
  // Longest slot id that prefixes the name
  let best = null;
  for (const s of ALL) if (key.startsWith(s.id + '.') && (!best || s.id.length > best.id.length)) best = s;
  return best;
}

export const isAudioFile = n => /\.(wav|ogg|mp3|flac|m4a|aac|opus|webm)$/i.test(n);
export const isImageFile = n => /\.(png|jpe?g|webp|avif)$/i.test(n);
