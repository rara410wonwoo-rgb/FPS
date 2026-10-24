import {it} from 'node:test';
import assert from 'node:assert/strict';
import {validateInput} from '../shared/protocol.js';
import {rayBox3} from '../shared/ray3.js';
import {generateMap,makeMap} from '../shared/map.js';
import {pointBlocked} from '../shared/collision.js';
import {initMoveState,stepMovement} from '../shared/movement.js';
import {emptyMatch,place} from './helpers.js';
import {fireShot} from '../server/combat.js';
import {WEAPONS} from '../shared/config.js';
it('phone pitch validates and rejects nonfinite/out of range values',()=>{
 const m={seq:1,mx:0,mz:0,aim:0,pitch:0.8};assert.equal(validateInput(m).pitch,0.8);
 for(const pitch of [NaN,Infinity,2,'0']) assert.equal(validateInput({...m,pitch}),null);
});
it('3D ray misses above a low wall and intersects elevated targets',()=>{
 const box={x:[4,5],y:[0,1],z:[-1,1]};assert.equal(rayBox3({x:0,y:1.6,z:0},{x:1,y:0,z:0},box,10),null);
 const m=emptyMatch(),a=place(m,'A',0,0),b=place(m,'B',20,0);b.y=10;
 a.control.pitch=0;fireShot(m,a,a.weapons[0],WEAPONS.kestrel);assert.equal(b.hp,100);
 a.control.pitch=Math.atan2(10,20);fireShot(m,a,a.weapons[0],WEAPONS.kestrel);assert.ok(b.hp<100);
});
it('house doorway and interior are walkable',()=>{
 const m=generateMap();for(const h of m.houses){const x=(h.minX+h.maxX)/2;assert.equal(pointBlocked(m.index,x,h.maxZ,0.55),false);assert.equal(pointBlocked(m.index,x,(h.minZ+h.maxZ)/2,0.55),false);}
});
it('aircraft exit, auto parachute and landing complete',()=>{
 const p=initMoveState({x:-200,z:0});p.drop=1;p.y=100;const m=makeMap([]);
 stepMovement(m.index,p,{mx:0,mz:0,jump:true},1/30,'kestrel');assert.equal(p.drop,2);
 let sawChute=false;for(let i=0;i<900;i++){stepMovement(m.index,p,{mx:0,mz:0,jump:false},1/30,'kestrel');if(p.drop===3)sawChute=true;}
 assert.ok(sawChute);assert.equal(p.drop,0);assert.equal(p.y,0);
});
